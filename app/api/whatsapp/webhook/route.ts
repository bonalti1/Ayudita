import { NextResponse } from "next/server";
import {
  createRawDocumentSignedUrl,
  createRawDecoderDocument,
  answerDecoderDocumentQuestion,
  answerLatestWhatsAppDocumentQuestion,
  disableDocumentMemory,
  explainDecoderDocument,
  extractDecoderDocument,
  findWhatsAppMemoryDocuments,
  getDecoderDocument,
  getLatestMemoryDocumentReference,
  getLatestPendingDocumentLabel,
  getLatestPendingMemorySelection,
  getLatestPendingSensitiveQuestion,
  getLatestPendingMemorySearch,
  hasProcessedWhatsAppMessage,
  listDecoderDocuments,
  markWhatsAppMessageProcessed,
  rememberPendingMemorySearch,
  rememberDocumentAlias,
  rememberLastMemoryDocument,
  rememberPendingDocumentLabel,
  rememberPendingMemorySelection,
  rememberPendingSensitiveQuestion,
  resolvePendingDocumentLabel,
  resolvePendingMemorySelection,
  resolvePendingMemorySearch,
  reviewDecoderDocument
} from "@/lib/decoder-store";
import { env } from "@/lib/env";
import { isReviewerGateEnabled, isReviewerPasswordValid } from "@/lib/reviewer-auth";
import { hasSensitiveFacts } from "@/lib/sensitive-documents";
import {
  downloadWhatsAppMedia,
  sendWhatsAppImageLink,
  sendWhatsAppReplyButtons,
  sendWhatsAppText,
  whatsappFileName
} from "@/lib/whatsapp";
import type { DecoderDocumentDetail } from "@/lib/decoder-types";

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
  interactive?: {
    type?: string;
    button_reply?: {
      id?: string;
      title?: string;
    };
    list_reply?: {
      id?: string;
      title?: string;
      description?: string;
    };
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
      await sendProcessingFailureIfPossible(message, error);
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

function getMessageText(message: WhatsAppMessage) {
  return (
    message.text?.body ??
    message.interactive?.button_reply?.title ??
    message.interactive?.button_reply?.id ??
    message.interactive?.list_reply?.title ??
    message.interactive?.list_reply?.id ??
    ""
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

  if (message.type === "text" || message.type === "interactive") {
    const text = getMessageText(message);

    const unlockResult = await processTextUnlockMessage({
      from,
      text,
      messageId: message.id
    });

    if (unlockResult) return unlockResult;

    const memorySelectionResult = await processTextMemorySelectionMessage({
      from,
      text,
      messageId: message.id
    });

    if (memorySelectionResult) return memorySelectionResult;

    const documentLabelResult = await processTextDocumentLabelMessage({
      from,
      text,
      messageId: message.id
    });

    if (documentLabelResult) return documentLabelResult;

    const memoryLabelResult = await processTextMemoryLabelMessage({
      from,
      text,
      messageId: message.id
    });

    if (memoryLabelResult) return memoryLabelResult;

    const memoryClarificationResult = await processTextMemoryClarificationMessage({
      from,
      text,
      messageId: message.id
    });

    if (memoryClarificationResult) return memoryClarificationResult;

    const memoryResult = await processTextMemoryMessage({
      from,
      text,
      messageId: message.id
    });

    if (memoryResult) return memoryResult;

    const followUpResult = await processTextFollowUpMessage({
      from,
      text,
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
  await askForDocumentLabel(documentId, to, explainedDocument.language);

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
      await rememberLastMemoryDocument({
        documentId: pendingDocument.id,
        userPhone: input.from
      });
      await askForDocumentLabel(pendingDocument.id, input.from, pendingDocument.language);

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
  await askForDocumentLabel(pendingDocument.id, input.from, explainedDocument.language);

  return {
    ok: true,
    messageId: input.messageId ?? null,
    documentId: pendingDocument.id,
    action: "sensitive_explanation_unlocked_and_sent"
  };
}

async function processTextMemorySelectionMessage(input: {
  from: string;
  text: string;
  messageId?: string;
}) {
  const selectedIndex = selectionIndexFromText(input.text);
  if (selectedIndex === null) return null;

  const pending = await getLatestPendingMemorySelection(input.from);
  if (!pending) return null;

  const documentId = pending.documentIds[selectedIndex];
  if (!documentId) {
    await sendTextIfConfigured(input.from, memorySelectionInvalidMessage(languageForText(pending.question)));

    return {
      ok: true,
      messageId: input.messageId ?? null,
      action: "memory_selection_invalid"
    };
  }

  await resolvePendingMemorySelection(pending.id);

  const document = await getDecoderDocument(documentId);
  if (!document) {
    await sendTextIfConfigured(input.from, memoryNotFoundMessage(languageForText(pending.question)));

    return {
      ok: true,
      messageId: input.messageId ?? null,
      action: "memory_selection_missing_document"
    };
  }

  return answerSelectedMemoryDocument({
    from: input.from,
    question: pending.question,
    messageId: input.messageId,
    document,
    aliasToRemember: pending.aliasToRemember
  });
}

async function processTextDocumentLabelMessage(input: {
  from: string;
  text: string;
  messageId?: string;
}) {
  const label = input.text.trim();
  if (!label || looksLikeNewDocumentQuestion(label)) return null;

  const pending = await getLatestPendingDocumentLabel(input.from);
  if (!pending) return null;

  if (!isDoNotSaveMemoryLabel(label) && looksLikeFollowUpQuestion(label)) return null;

  const cleanedLabel = documentLabelFromText(label);
  if (!cleanedLabel) return null;

  await resolvePendingDocumentLabel(pending.id);

  if (isDoNotSaveMemoryLabel(cleanedLabel)) {
    await disableDocumentMemory({
      documentId: pending.documentId,
      userPhone: input.from,
      reason: cleanedLabel
    });
    await sendTextIfConfigured(input.from, labelSkippedMessage(languageForText(label)));

    return {
      ok: true,
      messageId: input.messageId ?? null,
      documentId: pending.documentId,
      action: "document_memory_disabled"
    };
  }

  await rememberDocumentAlias({
    documentId: pending.documentId,
    userPhone: input.from,
    alias: cleanedLabel
  });
  await sendTextIfConfigured(input.from, labelSavedMessage(cleanedLabel, languageForText(label)));

  return {
    ok: true,
    messageId: input.messageId ?? null,
    documentId: pending.documentId,
    action: "document_label_saved"
  };
}

async function processTextMemoryLabelMessage(input: {
  from: string;
  text: string;
  messageId?: string;
}) {
  const label = memoryLabelFromSaveCommand(input.text);
  if (!label) return null;

  const documentId = await getLatestMemoryDocumentReference(input.from);
  if (!documentId) {
    await sendTextIfConfigured(input.from, missingMemoryLabelTargetMessage(languageForText(input.text)));

    return {
      ok: true,
      messageId: input.messageId ?? null,
      action: "memory_label_missing_target"
    };
  }

  await rememberDocumentAlias({
    documentId,
    userPhone: input.from,
    alias: label
  });
  await sendTextIfConfigured(input.from, memoryLabelSavedMessage(label, languageForText(input.text)));

  return {
    ok: true,
    messageId: input.messageId ?? null,
    documentId,
    action: "memory_label_saved"
  };
}

async function processTextMemoryClarificationMessage(input: {
  from: string;
  text: string;
  messageId?: string;
}) {
  const clarification = input.text.trim();
  if (!clarification || looksLikeNewDocumentQuestion(clarification)) return null;

  const pending = await getLatestPendingMemorySearch(input.from);
  if (!pending) return null;

  await resolvePendingMemorySearch(pending.id);

  const combinedQuestion = `${pending.query} ${clarification}`;
  const result = await answerMemoryQuestion({
    from: input.from,
    question: combinedQuestion,
    messageId: input.messageId,
    notFoundMessage: memoryStillNotFoundMessage(languageForText(combinedQuestion)),
    aliasToRemember: clarification
  });

  if (result) return { ...result, action: `${result.action}_after_clarification` };
  return null;
}

async function processTextMemoryMessage(input: {
  from: string;
  text: string;
  messageId?: string;
}) {
  const question = input.text.trim();
  if (!question || !looksLikeMemoryQuestion(question)) return null;

  if (needsMemoryClarification(question)) {
    await rememberPendingMemorySearch({
      userPhone: input.from,
      query: question
    });
    await sendButtonsIfConfigured({
      to: input.from,
      body: memoryClarificationMessage(languageForText(question)),
      buttons: memoryClarificationButtons(languageForText(question))
    });

    return {
      ok: true,
      messageId: input.messageId ?? null,
      action: "memory_clarification_requested"
    };
  }

  return answerMemoryQuestion({
    from: input.from,
    question,
    messageId: input.messageId,
    notFoundMessage: memoryNotFoundMessage(languageForText(question))
  });
}

async function answerMemoryQuestion(input: {
  from: string;
  question: string;
  messageId?: string;
  notFoundMessage: string;
  aliasToRemember?: string;
}) {
  const documents = await findWhatsAppMemoryDocuments({
    userPhone: input.from,
    query: input.question
  });
  const document = documents[0] ?? null;

  if (!document) {
    await sendTextIfConfigured(input.from, input.notFoundMessage);

    return {
      ok: true,
      messageId: input.messageId ?? null,
      action: "memory_not_found"
    };
  }

  if (documents.length > 1) {
    await rememberPendingMemorySelection({
      userPhone: input.from,
      question: input.question,
      documentIds: documents.map((match) => match.id),
      aliasToRemember: input.aliasToRemember
    });
    await sendMemoryPreviewImagesIfUseful({
      to: input.from,
      question: input.question,
      documents
    });
    await sendButtonsIfConfigured({
      to: input.from,
      body: memorySelectionMessage(documents, languageForText(input.question)),
      buttons: memorySelectionButtons(documents)
    });

    return {
      ok: true,
      messageId: input.messageId ?? null,
      action: "memory_selection_requested"
    };
  }

  return answerSelectedMemoryDocument({
    from: input.from,
    question: input.question,
    messageId: input.messageId,
    document,
    aliasToRemember: input.aliasToRemember
  });
}

async function sendMemoryPreviewImagesIfUseful(input: {
  to: string;
  question: string;
  documents: DecoderDocumentDetail[];
}) {
  if (!isCredentialMemoryQuestion(input.question)) return;

  const previewDocuments = input.documents
    .slice(0, 3)
    .filter((document) => document.mime_type?.startsWith("image/"));
  if (!previewDocuments.length) return;

  await sendTextIfConfigured(
    input.to,
    memoryPreviewIntroMessage(previewDocuments.length, languageForText(input.question))
  );

  for (const [index, document] of previewDocuments.entries()) {
    try {
      const signedUrl = await createRawDocumentSignedUrl(document);
      await sendImageIfConfigured({
        to: input.to,
        imageUrl: signedUrl,
        caption: memoryPreviewCaption(index + 1, document, languageForText(input.question))
      });
    } catch (error) {
      console.error("WhatsApp memory preview image failed.", {
        documentId: document.id,
        error
      });
    }
  }
}

async function answerSelectedMemoryDocument(input: {
  from: string;
  question: string;
  messageId?: string;
  document: DecoderDocumentDetail;
  aliasToRemember?: string;
}) {
  const document = input.document;

  if (hasSensitiveFacts(document.facts) && document.review_status !== "reviewed") {
    if (input.aliasToRemember) {
      await rememberDocumentAlias({
        documentId: document.id,
        userPhone: input.from,
        alias: input.aliasToRemember
      });
    }

    await rememberPendingSensitiveQuestion({
      documentId: document.id,
      userPhone: input.from,
      question: input.question
    });
    await sendTextIfConfigured(input.from, sensitivePasswordRequestMessage(languageForText(input.question)));

    return {
      ok: true,
      messageId: input.messageId ?? null,
      documentId: document.id,
      action: "memory_sensitive_password_requested"
    };
  }

  const answer = await answerDecoderDocumentQuestion({
    documentId: document.id,
    userPhone: input.from,
    question: input.question
  });

  if (!answer) return null;

  if (input.aliasToRemember) {
    await rememberDocumentAlias({
      documentId: answer.document.id,
      userPhone: input.from,
      alias: input.aliasToRemember
    });
  }

  await rememberLastMemoryDocument({
    documentId: answer.document.id,
    userPhone: input.from
  });
  await sendTextIfConfigured(input.from, answer.body);

  return {
    ok: true,
    messageId: input.messageId ?? null,
    documentId: answer.document.id,
    action: "memory_answered"
  };
}

async function processTextFollowUpMessage(input: {
  from: string;
  text: string;
  messageId?: string;
}) {
  const question = input.text.trim();
  if (!question) return null;
  if (looksLikeMemoryQuestion(question) || isCredentialMemoryQuestion(question)) return null;

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
    if (detail && hasSensitiveFacts(detail.facts) && (await getLatestPendingSensitiveQuestion(detail.id))) {
      return detail;
    }
  }

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

function looksLikeMemoryQuestion(text: string) {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (looksLikeFeedbackMessage(normalized)) return false;
  if (isCredentialMemoryQuestion(text)) return true;

  return /\b(find|search|show|remember|last|latest|previous|yesterday|earlier|papers|wifi|password|network|ssid|credential|busca|buscar|encuentra|muestra|muestrame|ultimo|ultima|anterior|ayer|contrasena|contraseña|red|clave|credencial)\b/.test(
    normalized
  ) && looksLikeSearchIntent(normalized);
}

function looksLikeNewDocumentQuestion(text: string) {
  return looksLikeMemoryQuestion(text) || isReviewerPasswordValid(text.trim());
}

function selectionIndexFromText(text: string) {
  const match = text.trim().match(/^(?:memory_select_)?([1-3])[\).:\s]*$/i);
  if (!match) return null;
  return Number(match[1]) - 1;
}

function needsMemoryClarification(text: string) {
  if (!isCredentialMemoryQuestion(text)) return false;

  const normalized = normalizeMemoryText(text);
  const hasSpecificContext =
    /\b(home|house|office|work|business|friend|neighbor|casa|hogar|oficina|trabajo|negocio|amigo|amiga|vecino|vecina)\b/.test(
      normalized
    ) || /\b[A-Z0-9][A-Z0-9_-]{3,}\b/.test(text);

  return !hasSpecificContext;
}

function isCredentialMemoryQuestion(text: string) {
  return /\b(wifi|wi fi|password|network|ssid|credential|contrasena|red|clave|credencial)\b/.test(
    normalizeMemoryText(text)
  );
}

function normalizeMemoryText(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

async function askForDocumentLabel(documentId: string, to: string, language?: string | null) {
  await rememberPendingDocumentLabel({
    documentId,
    userPhone: to
  });

  const promptLanguage = language === "en" ? "en" : "es";
  await sendButtonsIfConfigured({
    to,
    body: documentLabelPrompt(promptLanguage),
    buttons: documentLabelButtons(promptLanguage)
  });
}

function documentLabelFromText(text: string) {
  const cleaned = text
    .trim()
    .replace(/^(save as|label as|guardar como|etiqueta como)\s+/i, "")
    .replace(/\s+/g, " ");

  if (cleaned.length > 40) return null;
  if (cleaned.split(/\s+/).length > 5) return null;
  return cleaned;
}

function memoryLabelFromSaveCommand(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const match = trimmed.match(
    /^(?:(?:ok|okay|listo|va|ya esta|ya esta bien)[,\s]+)?(?:i\s+)?(?:just\s+)?(?:saved?|labeled?|label|remember(?:ed)?|name(?:d)?|guarda(?:r|do|lo|la)?|guardalo|guárdalo|etiqueta(?:r|do|lo|la)?|etiquetalo|etiquétalo|recuerda(?:r|lo|la)?|recuérdalo)\s+(?:this|that|it|document|doc|one|answer|esto|este|esta|documento|respuesta|eso)?\s*(?:as|como)\s+(.+)$/i
  );
  if (!match?.[1]) return null;

  const cleaned = match[1]
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^(?:my|mi|mine|mio|mía|mia)\s+/i, "")
    .replace(/\s+/g, " ");

  if (isDoNotSaveMemoryLabel(cleaned)) return null;
  if (cleaned.length > 80) return null;
  if (cleaned.split(/\s+/).length > 8) return null;
  return cleaned;
}

function isDoNotSaveMemoryLabel(label: string) {
  return /\b(dont save|don't save|do not save|skip|none|nada|no guardar|no save|no memory|sin memoria|not mine|not my|no es mio|no es mio|no mio|no es de mi|no es m[ií]o)\b/i.test(
    label
  );
}

function looksLikeSearchIntent(normalizedText: string) {
  return (
    /[?¿]/.test(normalizedText) ||
    /\b(find|search|show|remember|last|latest|previous|yesterday|earlier|busca|buscar|encuentra|muestra|muestrame|ultimo|ultima|anterior|ayer)\b/.test(
      normalizedText
    ) ||
    normalizedText.split(/\s+/).length <= 4
  );
}

function looksLikeFeedbackMessage(normalizedText: string) {
  return /\b(thank|thanks|gracias|good|perfect|perfecto|ok|okay|always ask|siempre pregunta)\b/.test(
    normalizedText
  );
}

function documentLabelPrompt(language: "en" | "es") {
  if (language === "en") {
    return "Should I save this for future search? Pick an option below, or type a custom label like home, office, client, or friend.";
  }

  return "Quieres que guarde esto para buscarlo despues? Escoge una opcion abajo, o escribe una etiqueta como casa, oficina, cliente o amigo.";
}

function documentLabelButtons(language: "en" | "es") {
  if (language === "en") {
    return [
      { id: "label_mine", title: "Mine" },
      { id: "label_not_mine", title: "Not mine" },
      { id: "label_do_not_save", title: "Do not save" }
    ];
  }

  return [
    { id: "label_mine", title: "Mio" },
    { id: "label_not_mine", title: "No es mio" },
    { id: "label_do_not_save", title: "No guardar" }
  ];
}

function labelSavedMessage(label: string, language: "en" | "es") {
  if (language === "en") return `Got it. I labeled this document as "${label}" for future searches.`;
  return `Listo. Etiquete este documento como "${label}" para buscarlo despues.`;
}

function memoryLabelSavedMessage(label: string, language: "en" | "es") {
  if (language === "en") return `Got it. I saved that document as "${label}" for future searches.`;
  return `Listo. Guarde ese documento como "${label}" para buscarlo despues.`;
}

function missingMemoryLabelTargetMessage(language: "en" | "es") {
  if (language === "en") {
    return "Tell me which saved document you mean first, then I can label it for future searches.";
  }

  return "Primero dime cual documento guardado quieres usar, y luego puedo etiquetarlo para futuras busquedas.";
}

function labelSkippedMessage(language: "en" | "es") {
  if (language === "en") {
    return "Okay. I will not use this document in future memory searches. You can still ask follow-up questions about it right now.";
  }

  return "Esta bien. No usare este documento en busquedas futuras de memoria. Todavia puedes hacer preguntas sobre el documento ahorita.";
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

function memoryClarificationMessage(language: "en" | "es") {
  if (language === "en") {
    return "Which one do you mean: home, office, business, or a friend's network? You can also send the network name if you know it.";
  }

  return "Cual quieres decir: casa, oficina, negocio o la red de un amigo? Tambien puedes mandarme el nombre de la red si lo sabes.";
}

function memoryClarificationButtons(language: "en" | "es") {
  if (language === "en") {
    return [
      { id: "clarify_home", title: "Home" },
      { id: "clarify_office", title: "Office" },
      { id: "clarify_business", title: "Business" }
    ];
  }

  return [
    { id: "clarify_home", title: "Casa" },
    { id: "clarify_office", title: "Oficina" },
    { id: "clarify_business", title: "Negocio" }
  ];
}

function memorySelectionMessage(documents: DecoderDocumentDetail[], language: "en" | "es") {
  const options = documents
    .slice(0, 3)
    .map((document, index) => `${index + 1}. ${documentSelectionLabel(document)}`)
    .join("\n");

  if (language === "en") {
    return `I found a few possible saved documents:\n${options}\nReply with 1, 2, or 3 so I answer from the right one.`;
  }

  return `Encontre varios documentos guardados que podrian ser:\n${options}\nResponde con 1, 2 o 3 para contestar del correcto.`;
}

function memorySelectionButtons(documents: DecoderDocumentDetail[]) {
  return documents.slice(0, 3).map((_, index) => ({
    id: `memory_select_${index + 1}`,
    title: String(index + 1)
  }));
}

function memoryPreviewIntroMessage(count: number, language: "en" | "es") {
  if (language === "en") {
    return `I found ${count} possible saved images. I will send them back so you can choose the right one.`;
  }

  return `Encontre ${count} imagenes guardadas posibles. Te las voy a mandar para que escojas la correcta.`;
}

function memoryPreviewCaption(index: number, document: DecoderDocumentDetail, language: "en" | "es") {
  const label = documentSelectionLabel(document);
  if (language === "en") return `Option ${index}: ${label}`;
  return `Opcion ${index}: ${label}`;
}

function memorySelectionInvalidMessage(language: "en" | "es") {
  if (language === "en") return "Choose one of the document numbers I listed: 1, 2, or 3.";
  return "Escoge uno de los numeros que te mande: 1, 2 o 3.";
}

function documentSelectionLabel(document: DecoderDocumentDetail) {
  const label =
    document.document_type?.trim() ||
    document.document_category
      ?.split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") ||
    "Document";

  return `${label} - ${formatDocumentDate(document.created_at)}`;
}

function formatDocumentDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "saved document";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function memoryNotFoundMessage(language: "en" | "es") {
  if (language === "en") {
    return "I could not find a saved document that matches that. You can send a new photo/PDF or ask for the latest document.";
  }

  return "No encontre un documento guardado que coincida con eso. Puedes mandar una nueva foto/PDF o preguntar por el documento mas reciente.";
}

function memoryStillNotFoundMessage(language: "en" | "es") {
  if (language === "en") {
    return "I still could not find a saved document with that extra detail. Try the network name, who sent it, or send the photo again.";
  }

  return "Todavia no encontre un documento guardado con ese detalle. Intenta con el nombre de la red, quien lo mando, o manda la foto otra vez.";
}

async function sendTextIfConfigured(to: string, body: string) {
  if (!env.whatsappAccessToken || !env.whatsappPhoneNumberId) {
    console.log("WhatsApp reply skipped because credentials are missing.");
    return;
  }
  await sendWhatsAppText(to, body);
}

async function sendImageIfConfigured(input: { to: string; imageUrl: string; caption?: string }) {
  if (!env.whatsappAccessToken || !env.whatsappPhoneNumberId) {
    console.log("WhatsApp image reply skipped because credentials are missing.");
    return;
  }
  await sendWhatsAppImageLink(input);
}

async function sendButtonsIfConfigured(input: {
  to: string;
  body: string;
  buttons: Array<{ id: string; title: string }>;
}) {
  if (!env.whatsappAccessToken || !env.whatsappPhoneNumberId) {
    console.log("WhatsApp button reply skipped because credentials are missing.");
    return;
  }

  try {
    await sendWhatsAppReplyButtons(input);
  } catch (error) {
    console.error("WhatsApp button reply failed. Falling back to text.", error);
    await sendWhatsAppText(input.to, fallbackButtonText(input.body, input.buttons));
  }
}

function fallbackButtonText(body: string, buttons: Array<{ title: string }>) {
  const options = buttons.map((button) => `- ${button.title}`).join("\n");
  return `${body}\n\n${options}`;
}

async function sendProcessingFailureIfPossible(message: WhatsAppMessage, error: unknown) {
  if (!message.from) return;

  try {
    await sendTextIfConfigured(message.from, processingFailureMessage(message, error));
  } catch (sendError) {
    console.error("Could not notify WhatsApp sender about processing failure.", sendError);
  }
}

function processingFailureMessage(message: WhatsAppMessage, error: unknown) {
  const errorMessage = error instanceof Error ? error.message : "";
  const mediaMessage = message.type === "image" || message.type === "document";

  if (mediaMessage && /401|Authentication Error|OAuthException/i.test(errorMessage)) {
    return "Recibi tu archivo, pero WhatsApp no me dejo descargarlo. Revisa el access token de WhatsApp en Render y vuelve a mandar la foto.";
  }

  if (mediaMessage) {
    return "Recibi tu archivo, pero no pude procesarlo. Intenta mandarlo otra vez con buena luz o como PDF.";
  }

  return "Recibi tu mensaje, pero algo fallo procesandolo. Intenta otra vez en un minuto.";
}
