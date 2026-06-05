import { randomUUID } from "crypto";
import { createSupabaseServiceClient } from "./supabase";
import type {
  DecoderDocument,
  DecoderDocumentDetail,
  DecoderDocumentSummary,
  DocumentSource,
  ReviewStatus
} from "./decoder-types";
import type { DecoderExtraction } from "./decoder-extraction-schema";
import {
  answerFollowUpWithOpenAI,
  explainFactsWithOpenAI,
  extractFactsWithOpenAI
} from "./decoder-openai";
import { sendWhatsAppText } from "./whatsapp";

const RAW_DOCUMENTS_BUCKET = "raw-documents";
const DEFAULT_WEB_USER_PHONE = "web-demo";
const WHATSAPP_MESSAGE_PREFIX = "whatsapp:message:";
const PENDING_SENSITIVE_QUESTION_PREFIX = "whatsapp:pending_sensitive_question:";

type CreateRawDocumentInput = {
  bytes: ArrayBuffer;
  fileName: string;
  mimeType: string;
  userPhone?: string;
  source?: DocumentSource;
};

type ReviewAction = "approve" | "flag" | "clearer_photo" | "reset";

export async function listDecoderDocuments(): Promise<DecoderDocumentSummary[]> {
  const supabase = createSupabaseServiceClient();

  const { data: documents, error } = await supabase
    .from("documents")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  if (!documents?.length) return [];

  const ids = documents.map((document) => document.id);

  const [{ data: facts, error: factsError }, { data: explanations, error: explanationsError }] =
    await Promise.all([
      supabase.from("facts").select("document_id").in("document_id", ids),
      supabase
        .from("explanations")
        .select("*")
        .in("document_id", ids)
        .order("created_at", { ascending: false })
    ]);

  if (factsError) throw factsError;
  if (explanationsError) throw explanationsError;

  return documents.map((document) => {
    const latestExplanation =
      explanations?.find((explanation) => explanation.document_id === document.id) ?? null;

    return {
      ...(document as DecoderDocument),
      latest_explanation: latestExplanation,
      facts_count: facts?.filter((fact) => fact.document_id === document.id).length ?? 0
    };
  });
}

export async function getDecoderDocument(documentId: string): Promise<DecoderDocumentDetail | null> {
  const supabase = createSupabaseServiceClient();

  const { data: document, error } = await supabase
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .maybeSingle();

  if (error) throw error;
  if (!document) return null;

  const [
    { data: facts, error: factsError },
    { data: explanations, error: explanationsError },
    { data: documentText, error: documentTextError }
  ] = await Promise.all([
    supabase.from("facts").select("*").eq("document_id", documentId).order("created_at"),
    supabase
      .from("explanations")
      .select("*")
      .eq("document_id", documentId)
      .order("created_at", { ascending: false }),
    supabase.from("document_text").select("*").eq("document_id", documentId).maybeSingle()
  ]);

  if (factsError) throw factsError;
  if (explanationsError) throw explanationsError;
  if (documentTextError) throw documentTextError;

  return {
    ...(document as DecoderDocument),
    facts: facts ?? [],
    explanations: explanations ?? [],
    document_text: documentText ?? null
  };
}

export async function createRawDecoderDocument(input: CreateRawDocumentInput) {
  const supabase = createSupabaseServiceClient();
  const safeFileName = sanitizeFileName(input.fileName);
  const userPhone = normalizeUserPhone(input.userPhone);
  const source = input.source ?? "web";
  const storagePath = `${source}/${userPhone}/${Date.now()}-${randomUUID()}-${safeFileName}`;

  const { error: uploadError } = await supabase.storage
    .from(RAW_DOCUMENTS_BUCKET)
    .upload(storagePath, input.bytes, {
      contentType: input.mimeType,
      upsert: false
    });

  if (uploadError) throw uploadError;

  const { data: document, error: documentError } = await supabase
    .from("documents")
    .insert({
      user_phone: userPhone,
      storage_path: storagePath,
      source,
      mime_type: input.mimeType,
      status: "received",
      review_status: "pending"
    })
    .select("*")
    .single();

  if (documentError) throw documentError;

  return document as DecoderDocument;
}

export async function extractDecoderDocument(documentId: string): Promise<DecoderDocumentDetail> {
  const document = await getDecoderDocument(documentId);
  if (!document) {
    throw new Error("Document not found.");
  }

  const supabase = createSupabaseServiceClient();

  const { data: file, error: downloadError } = await supabase.storage
    .from(RAW_DOCUMENTS_BUCKET)
    .download(document.storage_path);

  if (downloadError) throw downloadError;
  if (!file) throw new Error("Raw document file not found.");

  const { extraction, model } = await extractFactsWithOpenAI({
    bytes: await file.arrayBuffer(),
    mimeType: document.mime_type ?? "image/jpeg",
    fileName: document.storage_path.split("/").pop() ?? "document"
  });

  await storeExtraction(document.id, extraction, model);

  const extractedDocument = await getDecoderDocument(document.id);
  if (!extractedDocument) {
    throw new Error("Extracted document could not be loaded.");
  }

  return extractedDocument;
}

export async function explainDecoderDocument(documentId: string): Promise<DecoderDocumentDetail> {
  const document = await getDecoderDocument(documentId);
  if (!document) {
    throw new Error("Document not found.");
  }

  if (!document.facts.length) {
    throw new Error("Extract facts before generating an explanation.");
  }

  const { body, model } = await explainFactsWithOpenAI({
    facts: document.facts,
    language: document.language
  });

  const supabase = createSupabaseServiceClient();

  const { error: explanationError } = await supabase.from("explanations").insert({
    document_id: document.id,
    language: "es",
    body,
    model
  });

  if (explanationError) throw explanationError;

  const { error: documentError } = await supabase
    .from("documents")
    .update({ status: "explained" })
    .eq("id", document.id);

  if (documentError) throw documentError;

  const explainedDocument = await getDecoderDocument(document.id);
  if (!explainedDocument) {
    throw new Error("Explained document could not be loaded.");
  }

  return explainedDocument;
}

export async function reviewDecoderDocument(
  documentId: string,
  action: ReviewAction
): Promise<DecoderDocumentDetail> {
  const document = await getDecoderDocument(documentId);
  if (!document) {
    throw new Error("Document not found.");
  }

  const reviewStatus = reviewStatusForAction(action);
  const supabase = createSupabaseServiceClient();

  const { error } = await supabase
    .from("documents")
    .update({ review_status: reviewStatus })
    .eq("id", documentId);

  if (error) throw error;

  if (action === "clearer_photo") {
    await logClearerPhotoQuestion(document);
  }

  const reviewedDocument = await getDecoderDocument(documentId);
  if (!reviewedDocument) {
    throw new Error("Reviewed document could not be loaded.");
  }

  return reviewedDocument;
}

export async function sendReviewedExplanationToWhatsApp(
  documentId: string
): Promise<DecoderDocumentDetail> {
  const document = await getDecoderDocument(documentId);
  if (!document) {
    throw new Error("Document not found.");
  }

  if (document.source !== "whatsapp") {
    throw new Error("Only WhatsApp documents can be sent back through WhatsApp.");
  }

  if (document.review_status !== "reviewed") {
    throw new Error("Approve the explanation before sending it.");
  }

  const explanation = document.explanations[0];
  if (!explanation?.body) {
    throw new Error("Generate an explanation before sending it.");
  }

  await sendWhatsAppText(document.user_phone, explanation.body);
  await logWhatsAppSend(document, explanation.body);

  const sentDocument = await getDecoderDocument(document.id);
  if (!sentDocument) {
    throw new Error("Sent document could not be loaded.");
  }

  return sentDocument;
}

export async function answerLatestWhatsAppDocumentQuestion(input: {
  userPhone: string;
  question: string;
}) {
  const documents = await listDecoderDocuments();
  const latestDocument = documents.find(
    (document) =>
      document.source === "whatsapp" &&
      document.user_phone === input.userPhone &&
      (document.status === "extracted" || document.status === "explained")
  );

  if (!latestDocument) {
    return null;
  }

  const document = await getDecoderDocument(latestDocument.id);
  if (!document || !document.facts.length) {
    return null;
  }

  return answerDecoderDocumentQuestion({
    documentId: document.id,
    userPhone: input.userPhone,
    question: input.question
  });
}

export async function answerDecoderDocumentQuestion(input: {
  documentId: string;
  userPhone: string;
  question: string;
}) {
  const document = await getDecoderDocument(input.documentId);
  if (!document || !document.facts.length) {
    return null;
  }

  const { body, model } = await answerFollowUpWithOpenAI({
    question: input.question,
    facts: document.facts,
    explanations: document.explanations
  });

  await logUserQuestion({
    documentId: document.id,
    userPhone: input.userPhone,
    question: input.question,
    answer: body
  });

  return {
    document,
    body,
    model
  };
}

export async function rememberPendingSensitiveQuestion(input: {
  documentId: string;
  userPhone: string;
  question: string;
}) {
  await logUserQuestion({
    documentId: input.documentId,
    userPhone: input.userPhone,
    question: `${PENDING_SENSITIVE_QUESTION_PREFIX}${input.question}`,
    answer: "pending_password"
  });
}

export async function getLatestPendingSensitiveQuestion(documentId: string) {
  const supabase = createSupabaseServiceClient();

  const { data, error } = await supabase
    .from("user_questions")
    .select("question")
    .eq("document_id", documentId)
    .like("question", `${PENDING_SENSITIVE_QUESTION_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.question?.slice(PENDING_SENSITIVE_QUESTION_PREFIX.length) ?? null;
}

export async function hasProcessedWhatsAppMessage(messageId: string) {
  const supabase = createSupabaseServiceClient();

  const { data, error } = await supabase
    .from("user_questions")
    .select("id")
    .eq("question", `${WHATSAPP_MESSAGE_PREFIX}${messageId}`)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function markWhatsAppMessageProcessed(input: {
  messageId: string;
  userPhone: string;
  action?: string;
}) {
  await logUserQuestion({
    documentId: null,
    userPhone: input.userPhone,
    question: `${WHATSAPP_MESSAGE_PREFIX}${input.messageId}`,
    answer: input.action ?? "processing"
  });
}

function reviewStatusForAction(action: ReviewAction): ReviewStatus {
  if (action === "approve") return "reviewed";
  if (action === "reset") return "pending";
  return "flagged";
}

async function logClearerPhotoQuestion(document: DecoderDocumentDetail) {
  const supabase = createSupabaseServiceClient();
  const answer =
    "La foto no se pudo revisar con suficiente confianza. Pide una foto mas clara, con buena luz y la carta completa visible.";

  const { error } = await supabase.from("user_questions").insert({
    document_id: document.id,
    user_phone: document.user_phone,
    question: "manual_review:clearer_photo",
    answer
  });

  if (error) throw error;
}

async function logWhatsAppSend(document: DecoderDocumentDetail, body: string) {
  await logUserQuestion({
    documentId: document.id,
    userPhone: document.user_phone,
    question: "manual_review:sent_whatsapp",
    answer: body
  });
}

async function logUserQuestion(input: {
  documentId: string | null;
  userPhone: string;
  question: string;
  answer: string;
}) {
  const supabase = createSupabaseServiceClient();

  const { error } = await supabase.from("user_questions").insert({
    document_id: input.documentId,
    user_phone: input.userPhone,
    question: input.question,
    answer: input.answer
  });

  if (error) throw error;
}

async function storeExtraction(documentId: string, extraction: DecoderExtraction, model: string) {
  const supabase = createSupabaseServiceClient();
  const factRows = extractionToFactRows(documentId, extraction, model);

  const { error: deleteFactsError } = await supabase
    .from("facts")
    .delete()
    .eq("document_id", documentId);

  if (deleteFactsError) throw deleteFactsError;

  if (factRows.length) {
    const { error: factsError } = await supabase.from("facts").insert(factRows);
    if (factsError) throw factsError;
  }

  const { error: textError } = await supabase.from("document_text").upsert(
    {
      document_id: documentId,
      raw_text: null,
      language: extraction.language_detected,
      extraction_model: model
    },
    { onConflict: "document_id" }
  );

  if (textError) throw textError;

  const { error: documentError } = await supabase
    .from("documents")
    .update({
      status: "extracted",
      document_type: documentTypeTitle(extraction),
      language: extraction.language_detected
    })
    .eq("id", documentId);

  if (documentError) throw documentError;
}

function extractionToFactRows(documentId: string, extraction: DecoderExtraction, model: string) {
  const rows: Array<{
    document_id: string;
    fact_type: string;
    label: string | null;
    fact_value: string | null;
    provenance_type: string;
    source_text: string | null;
    page_number: number;
    model: string;
  }> = [];

  const single = (
    factType: string,
    fact: { value: string | null; provenance: string; source_text: string | null },
    label: string | null = null
  ) => {
    rows.push({
      document_id: documentId,
      fact_type: factType,
      label,
      fact_value: fact.value,
      provenance_type: fact.provenance,
      source_text: fact.source_text,
      page_number: 1,
      model
    });
  };

  single(
    "document_type",
    {
      value: categoryLabel(extraction.document_category),
      provenance: "INFERRED",
      source_text: extraction.document_type.source_text
    },
    "document_category"
  );
  single("document_type", extraction.document_type);
  single("action_required", extraction.detected_purpose, "detected_purpose");
  single("issuing_agency", extraction.issuing_agency);
  single("recipient_name", extraction.recipient_name);
  single("case_number", extraction.case_or_receipt_number);
  single("action_required", extraction.why_sent, "why_sent");
  single("fee", extraction.fees);

  for (const action of extraction.what_to_do) {
    rows.push({
      document_id: documentId,
      fact_type: "action_required",
      label: "what_to_do",
      fact_value: action.value,
      provenance_type: action.provenance,
      source_text: action.source_text,
      page_number: 1,
      model
    });
  }

  for (const date of extraction.key_dates) {
    rows.push({
      document_id: documentId,
      fact_type: "date",
      label: date.label,
      fact_value: date.value,
      provenance_type: date.provenance,
      source_text: date.source_text,
      page_number: date.page_number,
      model
    });
  }

  for (const fact of extraction.general_facts) {
    rows.push({
      document_id: documentId,
      fact_type: factTypeForGeneralFact(fact.category),
      label: `${fact.category}:${fact.label}`,
      fact_value: fact.value,
      provenance_type: fact.provenance,
      source_text: fact.source_text,
      page_number: fact.page_number,
      model
    });
  }

  for (const unreadableRegion of extraction.unreadable_regions) {
    rows.push({
      document_id: documentId,
      fact_type: "action_required",
      label: "unreadable_region",
      fact_value: unreadableRegion,
      provenance_type: "UNKNOWN",
      source_text: null,
      page_number: 1,
      model
    });
  }

  return rows;
}

function factTypeForGeneralFact(category: string) {
  if (category === "date") return "date";
  if (category === "amount") return "fee";
  return "action_required";
}

function documentTypeTitle(extraction: DecoderExtraction) {
  const type = extraction.document_type.value?.trim();
  if (type) return type;
  return categoryLabel(extraction.document_category);
}

function categoryLabel(category: string) {
  return category
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeUserPhone(userPhone?: string) {
  const trimmed = userPhone?.trim();
  return trimmed || DEFAULT_WEB_USER_PHONE;
}

function sanitizeFileName(fileName: string) {
  const clean = fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return clean || "document";
}
