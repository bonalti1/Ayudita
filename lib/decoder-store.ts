import { createHash, randomUUID } from "crypto";
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
const PENDING_MEMORY_SEARCH_PREFIX = "whatsapp:pending_memory_search:";
const DOCUMENT_ALIAS_PREFIX = "whatsapp:document_alias:";
const DOCUMENT_MEMORY_DISABLED_PREFIX = "whatsapp:document_memory_disabled:";
const PENDING_DOCUMENT_LABEL_PREFIX = "whatsapp:pending_document_label:";
const PENDING_MEMORY_SELECTION_PREFIX = "whatsapp:pending_memory_selection:";
const PENDING_CREDENTIAL_LABEL_PREFIX = "whatsapp:pending_credential_label:";
const PENDING_SOURCE_DOCUMENT_PREFIX = "whatsapp:pending_source_document:";
const LAST_MEMORY_DOCUMENT_PREFIX = "whatsapp:last_memory_document:";

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

export async function createRawDocumentSignedUrl(document: Pick<DecoderDocument, "storage_path">) {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.storage
    .from(RAW_DOCUMENTS_BUCKET)
    .createSignedUrl(document.storage_path, 60 * 60);

  if (error) throw error;
  return data.signedUrl;
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

export async function findWhatsAppMemoryDocument(input: {
  userPhone: string;
  query: string;
}): Promise<DecoderDocumentDetail | null> {
  const matches = await findWhatsAppMemoryDocuments(input);
  return matches[0] ?? null;
}

export async function findWhatsAppMemoryDocuments(input: {
  userPhone: string;
  query: string;
  limit?: number;
}): Promise<DecoderDocumentDetail[]> {
  const documents = await listDecoderDocuments();
  const candidates = documents.filter(
    (document) =>
      document.source === "whatsapp" &&
      document.user_phone === input.userPhone &&
      (document.status === "extracted" || document.status === "explained")
  );

  if (!candidates.length) return [];

  const details = (
    await Promise.all(candidates.slice(0, 30).map((document) => getDecoderDocument(document.id)))
  ).filter((document): document is DecoderDocumentDetail => Boolean(document?.facts.length));

  if (!details.length) return [];

  const disabledDocumentIds = await getMemoryDisabledDocumentIds(details.map((document) => document.id));
  const searchableDetails = details.filter((document) => !disabledDocumentIds.has(document.id));

  if (!searchableDetails.length) return [];

  const aliasesByDocumentId = await getDocumentAliasesById(
    searchableDetails.map((document) => document.id)
  );

  const ranked = searchableDetails
    .map((document, index) => ({
      document,
      score: scoreMemoryDocument(input.query, document, index, aliasesByDocumentId.get(document.id) ?? [])
    }))
    .sort((a, b) => b.score - a.score);

  const threshold = memoryMatchThreshold(input.query);
  const matches = ranked
    .filter((match) => match.score >= threshold)
    .map((match) => match.document);

  return dedupeMemoryDocuments(input.query, matches).slice(0, input.limit ?? 3);
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
    targetLanguage: detectQuestionLanguage(input.question),
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

export async function rememberPendingMemorySearch(input: { userPhone: string; query: string }) {
  await logUserQuestion({
    documentId: null,
    userPhone: input.userPhone,
    question: `${PENDING_MEMORY_SEARCH_PREFIX}${input.query}`,
    answer: "pending_clarification"
  });
}

export async function getLatestPendingMemorySearch(userPhone: string) {
  const supabase = createSupabaseServiceClient();

  const { data, error } = await supabase
    .from("user_questions")
    .select("id, question")
    .eq("user_phone", userPhone)
    .eq("answer", "pending_clarification")
    .like("question", `${PENDING_MEMORY_SEARCH_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id as string,
    query: (data.question as string).slice(PENDING_MEMORY_SEARCH_PREFIX.length)
  };
}

export async function resolvePendingMemorySearch(id: string, answer = "resolved") {
  const supabase = createSupabaseServiceClient();

  const { error } = await supabase.from("user_questions").update({ answer }).eq("id", id);
  if (error) throw error;
}

export async function rememberDocumentAlias(input: {
  documentId: string;
  userPhone: string;
  alias: string;
}) {
  const alias = cleanAlias(input.alias);
  if (!alias) return;

  await logUserQuestion({
    documentId: input.documentId,
    userPhone: input.userPhone,
    question: `${DOCUMENT_ALIAS_PREFIX}${alias}`,
    answer: "saved"
  });
}

export async function rememberLastMemoryDocument(input: {
  documentId: string;
  userPhone: string;
}) {
  await logUserQuestion({
    documentId: input.documentId,
    userPhone: input.userPhone,
    question: `${LAST_MEMORY_DOCUMENT_PREFIX}${input.documentId}`,
    answer: "active"
  });
}

export async function getLatestMemoryDocumentReference(userPhone: string) {
  const supabase = createSupabaseServiceClient();

  const { data, error } = await supabase
    .from("user_questions")
    .select("document_id")
    .eq("user_phone", userPhone)
    .eq("answer", "active")
    .like("question", `${LAST_MEMORY_DOCUMENT_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return typeof data?.document_id === "string" ? data.document_id : null;
}

export async function disableDocumentMemory(input: {
  documentId: string;
  userPhone: string;
  reason: string;
}) {
  const reason = cleanAlias(input.reason) || "not_saved";

  await logUserQuestion({
    documentId: input.documentId,
    userPhone: input.userPhone,
    question: `${DOCUMENT_MEMORY_DISABLED_PREFIX}${reason}`,
    answer: "disabled"
  });
}

export async function rememberPendingDocumentLabel(input: {
  documentId: string;
  userPhone: string;
}) {
  await logUserQuestion({
    documentId: input.documentId,
    userPhone: input.userPhone,
    question: `${PENDING_DOCUMENT_LABEL_PREFIX}${input.documentId}`,
    answer: "pending_label"
  });
}

export async function getLatestPendingDocumentLabel(userPhone: string) {
  const supabase = createSupabaseServiceClient();

  const { data, error } = await supabase
    .from("user_questions")
    .select("id, document_id")
    .eq("user_phone", userPhone)
    .eq("answer", "pending_label")
    .like("question", `${PENDING_DOCUMENT_LABEL_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data?.document_id) return null;

  return {
    id: data.id as string,
    documentId: data.document_id as string
  };
}

export async function resolvePendingDocumentLabel(id: string, answer = "resolved") {
  const supabase = createSupabaseServiceClient();

  const { error } = await supabase.from("user_questions").update({ answer }).eq("id", id);
  if (error) throw error;
}

export async function rememberPendingMemorySelection(input: {
  userPhone: string;
  question: string;
  documentIds: string[];
  aliasToRemember?: string;
}) {
  await logUserQuestion({
    documentId: null,
    userPhone: input.userPhone,
    question: `${PENDING_MEMORY_SELECTION_PREFIX}${input.question}`,
    answer: JSON.stringify({
      documentIds: input.documentIds.slice(0, 3),
      aliasToRemember: input.aliasToRemember
    })
  });
}

export async function getLatestPendingMemorySelection(userPhone: string) {
  const supabase = createSupabaseServiceClient();

  const { data, error } = await supabase
    .from("user_questions")
    .select("id, question, answer")
    .eq("user_phone", userPhone)
    .like("question", `${PENDING_MEMORY_SELECTION_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data?.answer || !data?.question) return null;

  const parsed = safeJsonParse(data.answer as string);
  const documentIds = Array.isArray(parsed?.documentIds)
    ? parsed.documentIds.filter((id: unknown): id is string => typeof id === "string")
    : [];

  if (!documentIds.length) return null;

  return {
    id: data.id as string,
    question: (data.question as string).slice(PENDING_MEMORY_SELECTION_PREFIX.length),
    documentIds,
    aliasToRemember: typeof parsed?.aliasToRemember === "string" ? parsed.aliasToRemember : undefined
  };
}

export async function resolvePendingMemorySelection(id: string, answer = "resolved") {
  const supabase = createSupabaseServiceClient();

  const { error } = await supabase.from("user_questions").update({ answer }).eq("id", id);
  if (error) throw error;
}

export async function rememberPendingCredentialLabel(input: {
  documentId: string;
  userPhone: string;
  alias: string;
}) {
  const alias = cleanAlias(input.alias);
  if (!alias) return;

  await logUserQuestion({
    documentId: input.documentId,
    userPhone: input.userPhone,
    question: `${PENDING_CREDENTIAL_LABEL_PREFIX}${alias}`,
    answer: "pending_credential_label"
  });
}

export async function getLatestPendingCredentialLabel(userPhone: string) {
  const supabase = createSupabaseServiceClient();

  const { data, error } = await supabase
    .from("user_questions")
    .select("id, document_id, question")
    .eq("user_phone", userPhone)
    .eq("answer", "pending_credential_label")
    .like("question", `${PENDING_CREDENTIAL_LABEL_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data?.document_id || !data?.question) return null;

  return {
    id: data.id as string,
    documentId: data.document_id as string,
    alias: (data.question as string).slice(PENDING_CREDENTIAL_LABEL_PREFIX.length)
  };
}

export async function resolvePendingCredentialLabel(id: string, answer = "resolved") {
  const supabase = createSupabaseServiceClient();

  const { error } = await supabase.from("user_questions").update({ answer }).eq("id", id);
  if (error) throw error;
}

export async function rememberPendingSourceDocument(input: {
  documentId: string;
  userPhone: string;
}) {
  await logUserQuestion({
    documentId: input.documentId,
    userPhone: input.userPhone,
    question: `${PENDING_SOURCE_DOCUMENT_PREFIX}${input.documentId}`,
    answer: "pending_source_document"
  });
}

export async function getLatestPendingSourceDocument(userPhone: string) {
  const supabase = createSupabaseServiceClient();

  const { data, error } = await supabase
    .from("user_questions")
    .select("id, document_id")
    .eq("user_phone", userPhone)
    .eq("answer", "pending_source_document")
    .like("question", `${PENDING_SOURCE_DOCUMENT_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data?.document_id) return null;

  return {
    id: data.id as string,
    documentId: data.document_id as string
  };
}

export async function resolvePendingSourceDocument(id: string, answer = "resolved") {
  const supabase = createSupabaseServiceClient();

  const { error } = await supabase.from("user_questions").update({ answer }).eq("id", id);
  if (error) throw error;
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

function detectQuestionLanguage(question: string): "en" | "es" {
  if (/[¿¡áéíóúñ]/i.test(question)) return "es";

  const normalized = question.toLowerCase();
  const englishSignals = /\b(what|when|where|why|how|need|do|pay|amount|who|is|this)\b/i;
  const spanishSignals =
    /\b(que|qué|cuando|cuándo|donde|dónde|porque|por qué|como|cómo|necesito|pagar|monto|quien|quién|es|esto)\b/i;

  if (englishSignals.test(normalized) && !spanishSignals.test(normalized)) return "en";
  return "es";
}

function scoreMemoryDocument(
  query: string,
  document: DecoderDocumentDetail,
  index: number,
  aliases: string[]
) {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = searchTokens(normalizedQuery);
  const corpus = normalizeSearchText(
    [
      document.document_type,
      document.document_category,
      document.storage_path,
      document.created_at,
      ...aliases,
      ...document.facts.flatMap((fact) => [
        fact.fact_type,
        fact.label,
        fact.fact_value,
        fact.source_text
      ])
    ]
      .filter(Boolean)
      .join(" ")
  );

  let score = 0;
  for (const token of tokens) {
    if (corpus.includes(token)) score += token.length >= 5 ? 3 : 2;
  }

  for (const alias of aliases.map(normalizeSearchText)) {
    if (alias && normalizedQuery.includes(alias)) score += 8;
  }

  if (mentionsAny(normalizedQuery, ["home", "house", "casa", "hogar"]) &&
    aliases.map(normalizeSearchText).some((alias) => mentionsAny(alias, ["office", "oficina", "work", "trabajo", "business", "negocio"]))) {
    score -= 10;
  }

  if (mentionsAny(normalizedQuery, ["office", "oficina", "work", "trabajo", "business", "negocio"]) &&
    aliases.map(normalizeSearchText).some((alias) => mentionsAny(alias, ["home", "house", "casa", "hogar"]))) {
    score -= 10;
  }

  if (/\b(last|latest|recent|previous|ultimo|ultima|reciente|anterior)\b/.test(normalizedQuery)) {
    score += Math.max(0, 4 - index);
  }

  if (/\b(toll|tolls|peaje|peajes)\b/.test(normalizedQuery) && /\b(toll|hctra|ccrma|peaje|peajes)\b/.test(corpus)) {
    score += 4;
  }

  if (/\b(wifi|wi fi|network|password|contrasena|contraseña|red)\b/.test(normalizedQuery) && /\b(wifi|wi fi|network|password|contrasena|contraseña|ssid|red)\b/.test(corpus)) {
    score += 4;
  }

  return score;
}

function mentionsAny(text: string, words: string[]) {
  return words.some((word) => new RegExp(`\\b${word}\\b`).test(text));
}

function dedupeMemoryDocuments(query: string, documents: DecoderDocumentDetail[]) {
  if (!isCredentialMemoryQuery(query)) return documents;

  const seen = new Set<string>();
  const unique: DecoderDocumentDetail[] = [];

  for (const document of documents) {
    const key = credentialDuplicateKey(document);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    unique.push(document);
  }

  return unique;
}

function credentialDuplicateKey(document: DecoderDocumentDetail) {
  const factKey = credentialFactDuplicateKey(document);
  if (factKey) return factKey;

  const facts = document.facts.map((fact) =>
    normalizeSearchText([fact.fact_type, fact.label, fact.fact_value, fact.source_text].filter(Boolean).join(" "))
  );
  const corpus = facts.join(" ");
  if (!isCredentialCorpus(corpus)) return null;

  const network = firstMeaningfulMatch(corpus, [
    /\b(?:network|ssid|red)\s+(?:name\s+)?([a-z0-9][a-z0-9_-]{2,})\b/,
    /\b(spectrumsetup[-\s]?[a-z0-9]+)\b/,
    /\b([a-z0-9][a-z0-9_-]*(?:wifi|wi fi|network)[a-z0-9_-]*)\b/
  ]);
  const password = firstMeaningfulMatch(corpus, [
    /\b(?:password|contrasena|clave)\s+([a-z0-9][a-z0-9_-]{5,})\b/
  ]);

  if (network && password) return `wifi:${network}:password:${password}`;
  if (password) return `wifi:password:${password}`;
  if (network) return `wifi:network:${network}`;
  return null;
}

function credentialFactDuplicateKey(document: DecoderDocumentDetail) {
  const networkValues = credentialFactValues(document, ["network", "ssid", "red"]);
  const passwordValues = credentialFactValues(document, ["password", "contrasena", "clave"]);

  const network = networkValues[0] ?? null;
  const password = passwordValues[0] ?? null;

  if (network && password) return hashedCredentialKey(["wifi", "network", network, "password", password]);
  if (password) return hashedCredentialKey(["wifi", "password", password]);
  if (network) return hashedCredentialKey(["wifi", "network", network]);
  return null;
}

function credentialFactValues(document: DecoderDocumentDetail, labelSignals: string[]) {
  const values: string[] = [];

  for (const fact of document.facts) {
    const labelText = normalizeSearchText([fact.fact_type, fact.label].filter(Boolean).join(" "));
    if (!mentionsAny(labelText, labelSignals)) continue;

    const value = normalizeCredentialValue(fact.fact_value);
    if (value && !values.includes(value)) values.push(value);
  }

  return values;
}

function normalizeCredentialValue(value?: string | null) {
  const normalized = normalizeSearchText(value ?? "");
  if (!normalized || credentialStopValues.has(normalized)) return null;
  return normalized;
}

function hashedCredentialKey(parts: string[]) {
  return `credential:${createHash("sha256").update(parts.join(":")).digest("hex")}`;
}

function firstMeaningfulMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value && !credentialStopValues.has(value)) return value;
  }
  return null;
}

function isCredentialMemoryQuery(query: string) {
  return isCredentialCorpus(normalizeSearchText(query));
}

function isCredentialCorpus(text: string) {
  return /\b(wifi|network|ssid|password|contrasena|clave|red)\b/.test(text);
}

const credentialStopValues = new Set([
  "settings",
  "screenshot",
  "password",
  "network",
  "wifi",
  "automatic",
  "fixed"
]);

async function getDocumentAliasesById(documentIds: string[]) {
  const aliasesByDocumentId = new Map<string, string[]>();
  if (!documentIds.length) return aliasesByDocumentId;

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("user_questions")
    .select("document_id, question")
    .in("document_id", documentIds)
    .like("question", `${DOCUMENT_ALIAS_PREFIX}%`);

  if (error) throw error;

  for (const row of data ?? []) {
    const documentId = row.document_id as string | null;
    const question = row.question as string | null;
    if (!documentId || !question) continue;

    const aliases = aliasesByDocumentId.get(documentId) ?? [];
    aliases.push(question.slice(DOCUMENT_ALIAS_PREFIX.length));
    aliasesByDocumentId.set(documentId, aliases);
  }

  return aliasesByDocumentId;
}

async function getMemoryDisabledDocumentIds(documentIds: string[]) {
  const disabledDocumentIds = new Set<string>();
  if (!documentIds.length) return disabledDocumentIds;

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("user_questions")
    .select("document_id")
    .in("document_id", documentIds)
    .eq("answer", "disabled")
    .like("question", `${DOCUMENT_MEMORY_DISABLED_PREFIX}%`);

  if (error) throw error;

  for (const row of data ?? []) {
    const documentId = row.document_id as string | null;
    if (documentId) disabledDocumentIds.add(documentId);
  }

  return disabledDocumentIds;
}

function cleanAlias(alias: string) {
  return alias.trim().slice(0, 80);
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value) as { documentIds?: unknown; aliasToRemember?: unknown };
  } catch {
    return null;
  }
}

function memoryMatchThreshold(query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (/\b(last|latest|recent|previous|ultimo|ultima|reciente|anterior)\b/.test(normalizedQuery)) {
    return 2;
  }
  return 3;
}

function searchTokens(normalizedQuery: string) {
  const stopWords = new Set([
    "what",
    "was",
    "that",
    "the",
    "from",
    "with",
    "show",
    "find",
    "search",
    "last",
    "latest",
    "me",
    "my",
    "que",
    "cual",
    "cuanto",
    "del",
    "con",
    "busca",
    "encuentra",
    "muestra",
    "ultimo",
    "ultima"
  ]);

  return normalizedQuery
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function normalizeSearchText(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/wi[\s-]?fi/g, "wifi")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeFileName(fileName: string) {
  const clean = fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return clean || "document";
}
