import { createSign } from "crypto";
import { env } from "./env";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const GOOGLE_DOC_MIME_TYPES = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.presentation",
  "application/vnd.google-apps.spreadsheet"
]);
const DIRECT_IMPORT_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export type DriveImportCandidate = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
};

export type DriveDownloadedFile = DriveImportCandidate & {
  bytes: ArrayBuffer;
  importMimeType: string;
  importName: string;
};

type DriveFileListResponse = {
  nextPageToken?: string;
  files?: DriveImportCandidate[];
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

export function isGoogleDriveConfigured() {
  return Boolean(
    env.googleDriveFolderId &&
      env.googleDriveServiceAccountEmail &&
      env.googleDrivePrivateKey
  );
}

export function googleDriveSetupError() {
  if (isGoogleDriveConfigured()) return null;
  return "Google Drive is not configured. Set GOOGLE_DRIVE_FOLDER_ID, GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL, and GOOGLE_DRIVE_PRIVATE_KEY.";
}

export async function listDriveFolderFiles(limit = 25) {
  const setupError = googleDriveSetupError();
  if (setupError) throw new Error(setupError);

  const files: DriveImportCandidate[] = [];
  let pageToken: string | undefined;

  while (files.length < limit) {
    const params = new URLSearchParams({
      q: `'${env.googleDriveFolderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink)",
      pageSize: String(Math.min(100, limit - files.length)),
      orderBy: "modifiedTime desc"
    });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await driveFetch(`${DRIVE_API_BASE}/files?${params.toString()}`);
    const data = (await response.json()) as DriveFileListResponse;
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return files.filter(isImportableDriveFile);
}

export async function downloadDriveFile(file: DriveImportCandidate): Promise<DriveDownloadedFile> {
  if (GOOGLE_DOC_MIME_TYPES.has(file.mimeType)) {
    return exportGoogleWorkspaceFile(file);
  }

  const response = await driveFetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(file.id)}?alt=media`);
  const bytes = await response.arrayBuffer();
  assertImportSize(bytes.byteLength, file.name);

  return {
    ...file,
    bytes,
    importMimeType: file.mimeType,
    importName: `drive-${file.id}-${file.name}`
  };
}

export function driveFileImportReason(file: DriveImportCandidate) {
  if (file.mimeType === FOLDER_MIME_TYPE) return "folder";
  if (!isImportableDriveFile(file)) return "unsupported_type";
  if (file.size && Number(file.size) > MAX_IMPORT_BYTES) return "too_large";
  return "importable";
}

function isImportableDriveFile(file: DriveImportCandidate) {
  if (file.mimeType === FOLDER_MIME_TYPE) return false;
  if (DIRECT_IMPORT_MIME_TYPES.has(file.mimeType)) return true;
  return GOOGLE_DOC_MIME_TYPES.has(file.mimeType);
}

async function exportGoogleWorkspaceFile(file: DriveImportCandidate): Promise<DriveDownloadedFile> {
  const response = await driveFetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(file.id)}/export?mimeType=application/pdf`
  );
  const bytes = await response.arrayBuffer();
  assertImportSize(bytes.byteLength, file.name);

  return {
    ...file,
    bytes,
    importMimeType: "application/pdf",
    importName: `drive-${file.id}-${file.name}.pdf`
  };
}

async function driveFetch(url: string, init?: RequestInit) {
  const token = await getDriveAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Google Drive request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  return response;
}

async function getDriveAccessToken() {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  if (!env.googleDriveServiceAccountEmail || !env.googleDrivePrivateKey) {
    throw new Error("Google Drive service account credentials are missing.");
  }

  const now = Math.floor(Date.now() / 1000);
  const jwt = signJwt({
    iss: env.googleDriveServiceAccountEmail,
    scope: DRIVE_SCOPE,
    aud: DRIVE_OAUTH_TOKEN_URL,
    iat: now,
    exp: now + 3600
  });

  const response = await fetch(DRIVE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });
  const data = (await response.json()) as GoogleTokenResponse;

  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description ?? data.error ?? "Google Drive token request failed."
    );
  }

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000
  };

  return cachedAccessToken.token;
}

function signJwt(payload: Record<string, string | number>) {
  const privateKey = normalizedPrivateKey(env.googleDrivePrivateKey);
  const header = { alg: "RS256", typ: "JWT" };
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey);
  return `${unsigned}.${base64Url(signature)}`;
}

function normalizedPrivateKey(privateKey?: string) {
  if (!privateKey) throw new Error("Google Drive private key is missing.");
  return privateKey.replace(/\\n/g, "\n");
}

function base64UrlJson(value: unknown) {
  return base64Url(Buffer.from(JSON.stringify(value)));
}

function base64Url(value: Buffer) {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function assertImportSize(byteLength: number, fileName: string) {
  if (byteLength > MAX_IMPORT_BYTES) {
    throw new Error(`${fileName} is too large to import. Max size is 20 MB.`);
  }
}
