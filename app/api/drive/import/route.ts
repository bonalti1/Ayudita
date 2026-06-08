import { NextResponse } from "next/server";
import { createRawDecoderDocument, listDecoderDocuments } from "@/lib/decoder-store";
import {
  downloadDriveFile,
  driveFileImportReason,
  googleDriveSetupError,
  listDriveFolderFiles
} from "@/lib/google-drive";

export const runtime = "nodejs";

const MAX_IMPORT_COUNT = 25;

export async function POST(request: Request) {
  try {
    const setupError = googleDriveSetupError();
    if (setupError) {
      return NextResponse.json({ error: setupError }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as { limit?: number; userPhone?: string } | null;
    const limit = Math.min(Math.max(Number(body?.limit ?? 10), 1), MAX_IMPORT_COUNT);
    const userPhone = body?.userPhone?.trim() || "drive-import";
    const existingDocuments = await listDecoderDocuments();
    const importedDriveIds = new Set(existingDocuments.map(driveIdFromStoragePath).filter(Boolean));
    const files = await listDriveFolderFiles(limit);
    const imported = [];
    const skipped = [];

    for (const file of files) {
      if (importedDriveIds.has(file.id)) {
        skipped.push({ id: file.id, name: file.name, reason: "already_imported" });
        continue;
      }

      const reason = driveFileImportReason(file);
      if (reason !== "importable") {
        skipped.push({ id: file.id, name: file.name, reason });
        continue;
      }

      try {
        const downloaded = await downloadDriveFile(file);
        const document = await createRawDecoderDocument({
          bytes: downloaded.bytes,
          fileName: downloaded.importName,
          mimeType: downloaded.importMimeType,
          userPhone,
          source: "drive"
        });

        imported.push({
          id: file.id,
          name: file.name,
          mimeType: downloaded.importMimeType,
          documentId: document.id
        });
        importedDriveIds.add(file.id);
      } catch (error) {
        skipped.push({
          id: file.id,
          name: file.name,
          reason: error instanceof Error ? error.message : "import_failed"
        });
      }
    }

    return NextResponse.json({
      imported,
      skipped,
      scanned: files.length
    });
  } catch (error) {
    console.error("Failed to import Google Drive folder.", error);
    return NextResponse.json({ error: "Failed to import Google Drive folder." }, { status: 500 });
  }
}

function driveIdFromStoragePath(document: { storage_path: string }) {
  const match = document.storage_path.match(/drive-([a-zA-Z0-9_-]+)-/);
  return match?.[1] ?? null;
}
