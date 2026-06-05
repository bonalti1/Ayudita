import { NextResponse } from "next/server";
import {
  createRawDecoderDocument,
  answerDecoderDocumentQuestion,
  answerLatestWhatsAppDocumentQuestion,
  explainDecoderDocument,
  extractDecoderDocument,
  getDecoderDocument,
  getLatestPendingSensitiveQuestion,
  hasProcessedWhatsAppMessage,
  listDecoderDocuments,
  markWhatsAppMessageProcessed,
  rememberPendingSensitiveQuestion,
  reviewDecoderDocument
} from "@/lib/decoder-store";
import { env } from "@/lib/env";
import { isReviewerGateEnabled, isReviewerPasswordValid } from "@/lib/reviewer-auth";
import { hasSensitiveFacts } from "@/lib/sensitive-documents";
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
  console.log("WhatsApp webhook received.", {
    messages: messages.length,
    entries: payload.entry?.length ?? 0
  });

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

  console.log("Processing WhatsApp message.", {
    messageId: message.id ?? null,
    from,
    type: message.type ?? "unknown"
  });

  const duplicateResult = await dedupeWhatsAppMessage(message, from);
  if (duplicateResult) return duplicateResult;

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

  if (message.type === "text") {
    const unlockResult = await processTextUnlockMessage({
      from,
      text: message.text?.body ?? "",
      messageId: message.id
    });

    if (unlockResult) return unlockResult;

    const followUpResult = await processTextFollowUpMessage({
      from,
      text: message.text?.body ?? "",
      messageId: message.id
    });

    if (followUpResult) return followUpResult;
  }

  await sendTextIfConfigured(
    from,
    "Mandame una foto o PDF del documento, carta o screenshot que quieres entender."
  );

  console.log("Prompted WhatsApp sender for a document.", {
    messageId: message.id ?? null,
    from
  });

  return {
    ok: true,
    messageId: message.id ?? null,
    type: message.type ?? "unknown",
    action: "prompted_for_document"
  };
}

async function dedupeWhatsAppMessage(message: WhatsAppMessage, from: string) {
  if (!message.id) return null;

  if (await hasProcessedWhatsAppMessage(message.id)) {
    console.log("Duplicate WhatsApp message ignored.", {
      messageId: message.id,
      from,
      type: message.type ?? "unknown"
    });

    return {
      ok: true,
      messageId: message.id,
      type: message.type ?? "unknown",
      action: "duplicate_ignored"
    };
  }

  await markWhatsAppMessageProcessed({
    messageId: message.id,
    userPhone: from,
    action: message.type ?? "unknown"
  });

  return null;
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
    "Recibi tu documento. Primero lo guarde de forma segura. Ahora voy a revisar si tiene informacion sensible."
  );

  console.log("Stored WhatsApp media document.", {
    messageId: input.messageId ?? null,
    from: input.from,
    documentId: document.id,
    mimeType
  });

  const action = await processStoredDocumentForWhatsApp(document.id, input.from);

  return {
    ok: true,
    messageId: input.messageId ?? null,
    documentId: document.id,
    status: action.status,
    reviewStatus: action.reviewStatus,
    action: action.action
  };
}

async function processStoredDocumentForWhatsApp(documentId: string, to: string) {
  const extractedDocument = await extractDecoderDocument(documentId);

  if (hasSensitiveFacts(extractedDocument.facts)) {
    if (!isReviewerGateEnabled()) {
      await sendTextIfConfigured(
        to,
        "Encontre informacion sensible en este documento, pero falta configurar la contraseña de revision."
      );
    } else {
      await sendTextIfConfigured(
        to,
        "Encontre informacion sensible en este documento. Para revelarla por WhatsApp, responde con la contraseña de revision."
      );
    }

    return {
      status: extractedDocument.status,
      reviewStatus: extractedDocument.review_status,
      action: "sensitive_password_requested"
    };
  }

  const explainedDocument = await explainDecoderDocument(documentId);
  await reviewDecoderDocument(documentId, "approve");
  await sendTextIfConfigured(to, explainedDocument.explanations[0]?.body ?? "Documento explicado.");

  return {
    status: "explained",
    reviewStatus: "reviewed",
    action: "explained_and_sent"
  };
}

async function processTextUnlockMessage(input: {
  from: string;
  text: string;
  messageId?: string;
}) {
  const pendingDocument = await latestSensitivePendingDocument(input.from);
  if (!pendingDocument) return null;

  const text = input.text.trim();

  if (!isReviewerPasswordValid(text)) {
    if (looksLikeFollowUpQuestion(text)) {
      await rememberPendingSensitiveQuestion({
        documentId: pendingDocument.id,
        userPhone: input.from,
        question: text
      });
    }

    await sendTextIfConfigured(input.from, sensitivePasswordRequestMessage(languageForText(text)));

    return {
      ok: true,
      messageId: input.messageId ?? null,
      documentId: pendingDocument.id,
      action: "sensitive_password_rejected"
    };
  }

  const explainedDocument = pendingDocument.explanations.length
    ? pendingDocument
    : await explainDecoderDocument(pendingDocument.id);

  await reviewDecoderDocument(pendingDocument.id, "approve");

  const pendingQuestion = await getLatestPendingSensitiveQuestion(pendingDocument.id);
  if (pendingQuestion) {
    const answer = await answerDecoderDocumentQuestion({
      documentId: pendingDocument.id,
      userPhone: input.from,
      question: pendingQuestion
    });

    if (answer) {
      await sendTextIfConfigured(input.from, answer.body);

      return {
        ok: true,
        messageId: input.messageId ?? null,
        documentId: pendingDocument.id,
        action: "sensitive_pending_question_unlocked_and_answered"
      };
    }
  }

  await sendTextIfConfigured(
    input.from,
    explainedDocument.explanations[0]?.body ?? "No pude generar la explicacion."
  );

  return {
    ok: true,
    messageId: input.messageId ?? null,
    documentId: pendingDocument.id,
    action: "sensitive_explanation_unlocked_and_sent"
  };
}

async function processTextFollowUpMessage(input: {
  from: string;
  text: string;
  messageId?: string;
}) {
  const question = input.text.trim();
  if (!question) return null;

  const answer = await answerLatestWhatsAppDocumentQuestion({
    userPhone: input.from,
    question
  });

  if (!answer) return null;

  await sendTextIfConfigured(input.from, answer.body);

  return {
    ok: true,
    messageId: input.messageId ?? null,
    documentId: answer.document.id,
    action: "follow_up_answered"
  };
}

async function latestSensitivePendingDocument(userPhone: string) {
  const documents = await listDecoderDocuments();
  const candidates = documents.filter(
    (document) =>
      document.source === "whatsapp" &&
      document.user_phone === userPhone &&
      document.review_status !== "reviewed" &&
      (document.status === "extracted" || document.status === "explained")
  );

  for (const candidate of candidates) {
    const detail = await getDecoderDocument(candidate.id);
    if (detail && hasSensitiveFacts(detail.facts)) return detail;
  }

  return null;
}

function looksLikeFollowUpQuestion(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.length > 12) return true;
  return /[?¿]/.test(trimmed);
}

function languageForText(text: string): "en" | "es" {
  const normalized = text.toLowerCase();
  if (/[¿¡áéíóúñ]/i.test(text)) return "es";

  const englishSignals = /\b(what|when|where|why|how|need|do|pay|amount|who|is|this)\b/i;
  const spanishSignals =
    /\b(que|qué|cuando|cuándo|donde|dónde|porque|por qué|como|cómo|necesito|pagar|monto|quien|quién|es|esto)\b/i;

  if (englishSignals.test(normalized) && !spanishSignals.test(normalized)) return "en";
  return "es";
}

function sensitivePasswordRequestMessage(language: "en" | "es") {
  if (language === "en") {
    return "This document has sensitive information. Reply with the review password so I can answer that here in WhatsApp.";
  }

  return "Este documento tiene informacion sensible. Responde con la contraseña correcta de revision para revelarla.";
}

async function sendTextIfConfigured(to: string, body: string) {
  if (!env.whatsappAccessToken || !env.whatsappPhoneNumberId) {
    console.log("WhatsApp reply skipped because credentials are missing.");
    return;
  }
  await sendWhatsAppText(to, body);
}
