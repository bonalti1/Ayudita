import { env } from "./env";

type WhatsAppMedia = {
  bytes: ArrayBuffer;
  mimeType: string;
};

type WhatsAppMediaMetadata = {
  url?: string;
  mime_type?: string;
  error?: {
    message?: string;
  };
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
    throw new Error(metadata?.error?.message ?? "Could not load WhatsApp media metadata.");
  }

  const fileResponse = await fetch(metadata.url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!fileResponse.ok) {
    throw new Error("Could not download WhatsApp media file.");
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
    throw new Error("Could not send WhatsApp message.");
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

function mimeExtension(mimeType: string) {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}
