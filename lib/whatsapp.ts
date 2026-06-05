import { env } from "./env";

type WhatsAppMedia = {
  bytes: ArrayBuffer;
  mimeType: string;
};

type WhatsAppMediaMetadata = {
  url?: string;
  mime_type?: string;
  error?: WhatsAppGraphError;
};

const DEFAULT_IMAGE_MIME = "image/jpeg";

export async function downloadWhatsAppMedia(mediaId: string): Promise<WhatsAppMedia> {
  const token = requireWhatsAppAccessToken();
  const graphBase = whatsappGraphBase();

  const metadataResponse = await fetch(`${graphBase}/${mediaId}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const metadata = (await metadataResponse.json().catch(() => null)) as WhatsAppMediaMetadata | null;

  if (!metadataResponse.ok || !metadata?.url) {
    throw new Error(
      formatWhatsAppError(
        "Could not load WhatsApp media metadata.",
        metadataResponse.status,
        metadata?.error
      )
    );
  }

  const fileResponse = await fetch(metadata.url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!fileResponse.ok) {
    const error = await readWhatsAppError(fileResponse);
    throw new Error(
      formatWhatsAppError("Could not download WhatsApp media file.", fileResponse.status, error)
    );
  }

  return {
    bytes: await fileResponse.arrayBuffer(),
    mimeType: metadata.mime_type ?? DEFAULT_IMAGE_MIME
  };
}

export async function sendWhatsAppText(to: string, body: string) {
  const token = requireWhatsAppAccessToken();
  const phoneNumberId = requireWhatsAppPhoneNumberId();
  const graphBase = whatsappGraphBase();

  const response = await fetch(`${graphBase}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body }
    })
  });

  if (!response.ok) {
    const error = await readWhatsAppError(response);
    throw new Error(formatWhatsAppError("Could not send WhatsApp message.", response.status, error));
  }
}

export async function sendWhatsAppImageLink(input: {
  to: string;
  imageUrl: string;
  caption?: string;
}) {
  const token = requireWhatsAppAccessToken();
  const phoneNumberId = requireWhatsAppPhoneNumberId();
  const graphBase = whatsappGraphBase();

  const response = await fetch(`${graphBase}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: input.to,
      type: "image",
      image: {
        link: input.imageUrl,
        caption: input.caption?.slice(0, 1024)
      }
    })
  });

  if (!response.ok) {
    const error = await readWhatsAppError(response);
    throw new Error(formatWhatsAppError("Could not send WhatsApp image.", response.status, error));
  }
}

export async function sendWhatsAppReplyButtons(input: {
  to: string;
  body: string;
  buttons: Array<{ id: string; title: string }>;
}) {
  const token = requireWhatsAppAccessToken();
  const phoneNumberId = requireWhatsAppPhoneNumberId();
  const graphBase = whatsappGraphBase();
  const buttons = input.buttons.slice(0, 3).map((button) => ({
    type: "reply",
    reply: {
      id: button.id.slice(0, 256),
      title: button.title.slice(0, 20)
    }
  }));

  const response = await fetch(`${graphBase}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: input.to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: input.body },
        action: { buttons }
      }
    })
  });

  if (!response.ok) {
    const error = await readWhatsAppError(response);
    throw new Error(formatWhatsAppError("Could not send WhatsApp buttons.", response.status, error));
  }
}

export function whatsappFileName(mediaId: string, mimeType: string, fallbackName?: string) {
  if (fallbackName?.trim()) return fallbackName.trim();

  const extension = mimeExtension(mimeType);
  return `whatsapp-${mediaId}.${extension}`;
}

function whatsappGraphBase() {
  return `https://graph.facebook.com/${env.whatsappGraphVersion}`;
}

function requireWhatsAppAccessToken() {
  if (!env.whatsappAccessToken) {
    throw new Error("Missing WHATSAPP_ACCESS_TOKEN.");
  }

  return env.whatsappAccessToken;
}

function requireWhatsAppPhoneNumberId() {
  if (!env.whatsappPhoneNumberId) {
    throw new Error("Missing WHATSAPP_PHONE_NUMBER_ID.");
  }

  return env.whatsappPhoneNumberId;
}

type WhatsAppGraphError = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
};

type WhatsAppGraphErrorBody = {
  error?: WhatsAppGraphError;
};

async function readWhatsAppError(response: Response) {
  const body = (await response.json().catch(() => null)) as WhatsAppGraphErrorBody | null;
  return body?.error;
}

function formatWhatsAppError(fallback: string, status: number, error?: WhatsAppGraphError) {
  const details = [
    `Meta status ${status}`,
    error?.message,
    error?.type ? `type ${error.type}` : undefined,
    typeof error?.code === "number" ? `code ${error.code}` : undefined,
    typeof error?.error_subcode === "number" ? `subcode ${error.error_subcode}` : undefined,
    error?.fbtrace_id ? `trace ${error.fbtrace_id}` : undefined
  ].filter(Boolean);

  return details.length ? `${fallback} ${details.join(" | ")}` : fallback;
}

function mimeExtension(mimeType: string) {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}
