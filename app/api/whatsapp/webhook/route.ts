import { NextResponse } from "next/server";
import { createRawDecoderDocument } from "@/lib/decoder-store";
import { env } from "@/lib/env";
import { downloadWhatsAppMedia, sendWhatsAppText, whatsappFileName } from "@/lib/whatsapp";

export const runtime = "nodejs";

type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WhatsAppMessage[];
      };
    }>;
  }>;
};

type WhatsAppMessage = {
  from?: string;
  id?: string;
  type?: string;
  text?: {
    body?: string;
  };
  image?: {
    id?: string;
    mime_type?: string;
  };
  document?: {
    id?: string;
    filename?: string;
    mime_type?: string;
  };
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === env.whatsappVerifyToken && challenge) {
    return new Response(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Invalid verification token." }, { status: 403 });
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as WhatsAppWebhookPayload | null;

  if (!payload) {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  const messages = getMessages(payload);
  const results = [];

  for (const message of messages) {
    try {
      results.push(await processMessage(message));
    } catch (error) {
      console.error("WhatsApp message processing failed.", error);
      results.push({
        ok: false,
        messageId: message.id ?? null,
        error: error instanceof Error ? error.message : "Unknown error."
      });
    }
  }

  return NextResponse.json({ received: true, processed: results.length, results });
}

function getMessages(payload: WhatsAppWebhookPayload) {
  return (
    payload.entry?.flatMap((entry) =>
      entry.changes?.flatMap((change) => change.value?.messages ?? []) ?? []
    ) ?? []
  );
}

async function processMessage(message: WhatsAppMessage) {
  const from = message.from;

  if (!from) {
    throw new Error("WhatsApp message is missing sender.");
  }

  if (message.type === "image") {
    return ingestMediaMessage({
      from,
      mediaId: message.image?.id,
      fallbackMimeType: message.image?.mime_type,
      fallbackName: undefined,
      messageId: message.id
    });
  }

  if (message.type === "document") {
    return ingestMediaMessage({
      from,
      mediaId: message.document?.id,
      fallbackMimeType: message.document?.mime_type,
      fallbackName: message.document?.filename,
      messageId: message.id
    });
  }

  await sendTextIfConfigured(
    from,
    "Mandame una foto o PDF de la carta que recibiste y te ayudo a entender que dice."
  );

  return {
    ok: true,
    messageId: message.id ?? null,
    type: message.type ?? "unknown",
    action: "prompted_for_document"
  };
}

async function ingestMediaMessage(input: {
  from: string;
  mediaId?: string;
  fallbackMimeType?: string;
  fallbackName?: string;
  messageId?: string;
}) {
  if (!input.mediaId) {
    throw new Error("WhatsApp media message is missing media id.");
  }

  const media = await downloadWhatsAppMedia(input.mediaId);
  const mimeType = media.mimeType || input.fallbackMimeType || "image/jpeg";
  const document = await createRawDecoderDocument({
    bytes: media.bytes,
    fileName: whatsappFileName(input.mediaId, mimeType, input.fallbackName),
    mimeType,
    userPhone: input.from,
    source: "whatsapp"
  });

  await sendTextIfConfigured(
    input.from,
    "Recibi tu documento. Primero lo guarde de forma segura y lo pondre en revision."
  );

  return {
    ok: true,
    messageId: input.messageId ?? null,
    documentId: document.id,
    status: document.status,
    reviewStatus: document.review_status
  };
}

async function sendTextIfConfigured(to: string, body: string) {
  if (!env.whatsappAccessToken || !env.whatsappPhoneNumberId) return;
  await sendWhatsAppText(to, body);
}
