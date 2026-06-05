import { getDecoderDocument, listDecoderDocuments } from "./decoder-store";
import { sanitizeDocumentDetail } from "./sensitive-documents";
import type { DecoderDocumentDetail, DecoderFact } from "./decoder-types";
import { listTrustedAnswers, type TrustedAnswerGroup } from "./trusted-answers";

type MemoryCandidate = {
  document: DecoderDocumentDetail;
  score: number;
  answerFact: DecoderFact | null;
};

type TrustedAnswerCandidate = {
  answer: TrustedAnswerGroup;
  score: number;
};

export type MemoryQueryResult = {
  answer: string | null;
  confidence: "high" | "medium" | "low" | "none";
  answer_source?: "trusted_answer" | "document";
  duplicate_source_count?: number;
  message?: string;
  document?: {
    id: string;
    title: string;
    source: string;
    mime_type: string | null;
    created_at: string;
    memory_aliases: string[];
    has_sensitive_info?: boolean;
    sensitive_info_locked?: boolean;
  };
  fact?: {
    label: string | null;
    fact_type: string;
    fact_value: string | null;
    source_text: string | null;
  } | null;
};

export async function querySavedMemory(input: {
  question: string;
  userPhone?: string;
  isUnlocked?: boolean;
}): Promise<MemoryQueryResult> {
  const question = input.question.trim();
  const trustedResult = await queryTrustedAnswerMemory({
    question,
    userPhone: input.userPhone,
    isUnlocked: input.isUnlocked
  });
  if (trustedResult) return trustedResult;

  const summaries = await listDecoderDocuments();
  const memorySummaries = summaries
    .filter(
      (document) =>
        (!input.userPhone || document.user_phone === input.userPhone) &&
        !document.memory_disabled &&
        (document.status === "extracted" || document.status === "explained") &&
        (document.memory_aliases?.length || document.has_credential_facts || document.facts_count > 0)
    )
    .slice(0, 40);

  const documents = (
    await Promise.all(memorySummaries.map((document) => getDecoderDocument(document.id)))
  ).filter((document): document is DecoderDocumentDetail => Boolean(document?.facts.length));

  const candidates = documents
    .map((document) => rankMemoryCandidate(question, document))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best) {
    return {
      answer: null,
      confidence: "none",
      message: "I could not find a saved memory that clearly matches that question."
    };
  }

  const sanitizedDocument = sanitizeDocumentDetail(best.document, Boolean(input.isUnlocked));
  const duplicateCount = countDuplicateSources(best.document, documents);
  const answerFact = findSanitizedFact(best.answerFact, sanitizedDocument);

  return {
    answer: buildAnswer(question, sanitizedDocument, answerFact),
    confidence: best.score >= 12 ? "high" : best.score >= 7 ? "medium" : "low",
    answer_source: "document",
    duplicate_source_count: duplicateCount,
    document: {
      id: sanitizedDocument.id,
      title: sanitizedDocument.document_type ?? sanitizedDocument.document_category ?? "Saved document",
      source: sanitizedDocument.source,
      mime_type: sanitizedDocument.mime_type,
      created_at: sanitizedDocument.created_at,
      memory_aliases: sanitizedDocument.memory_aliases ?? [],
      has_sensitive_info: sanitizedDocument.has_sensitive_info,
      sensitive_info_locked: sanitizedDocument.sensitive_info_locked
    },
    fact: answerFact
      ? {
          label: answerFact.label,
          fact_type: answerFact.fact_type,
          fact_value: answerFact.fact_value,
          source_text: answerFact.source_text
        }
      : null
  };
}

async function queryTrustedAnswerMemory(input: {
  question: string;
  userPhone?: string;
  isUnlocked?: boolean;
}): Promise<MemoryQueryResult | null> {
  const trustedAnswers = await listTrustedAnswers({
    userPhone: input.userPhone,
    isUnlocked: input.isUnlocked
  });

  const candidates = trustedAnswers
    .map((answer) => rankTrustedAnswerCandidate(input.question, answer))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best) return null;

  const confidence =
    best.answer.confidence === "high" && best.score >= 8
      ? "high"
      : best.score >= 10
        ? "high"
        : best.score >= 6
          ? "medium"
          : "low";

  if (confidence === "low") return null;

  return {
    answer: buildTrustedAnswer(input.question, best.answer),
    confidence,
    answer_source: "trusted_answer",
    duplicate_source_count: best.answer.source_count,
    document: {
      id: best.answer.main_document_id,
      title: best.answer.main_source_title,
      source: best.answer.sources[0]?.source ?? "saved",
      mime_type: best.answer.sources[0]?.mime_type ?? null,
      created_at: best.answer.sources[0]?.created_at ?? new Date(0).toISOString(),
      memory_aliases: best.answer.aliases
    },
    fact: {
      label: best.answer.answer_label,
      fact_type: "trusted_answer",
      fact_value: best.answer.answer_value,
      source_text: best.answer.answer_source_text
    }
  };
}

function rankTrustedAnswerCandidate(question: string, answer: TrustedAnswerGroup): TrustedAnswerCandidate {
  const questionTokens = tokenize(question);
  const haystack = [
    answer.title,
    answer.answer_label,
    answer.answer_value,
    answer.main_source_title,
    answer.answer_source_text,
    ...answer.aliases,
    ...answer.sources.map((source) => source.title)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let score = 0;
  for (const token of questionTokens) {
    if (haystack.includes(token)) score += token.length > 4 ? 2 : 1;
  }

  const normalizedQuestion = question.toLowerCase();
  const normalizedTitle = answer.title.toLowerCase();
  if (normalizedQuestion.includes(normalizedTitle)) score += 8;
  if (answer.aliases.some((alias) => normalizedQuestion.includes(alias.toLowerCase()))) score += 8;

  const isCredentialQuestion = looksLikeCredentialQuestion(question);
  const isCredentialAnswer = includesAny(`${answer.title} ${answer.answer_label}`, [
    "password",
    "credential",
    "wifi",
    "wi-fi",
    "network"
  ]);
  if (isCredentialQuestion && isCredentialAnswer) score += 12;
  if (isCredentialQuestion && !isCredentialAnswer) score -= 8;

  if (answer.answer_value) score += 3;
  if (answer.source_count > 1) score += 3;
  if (answer.confidence === "high") score += 2;

  return { answer, score };
}

function buildTrustedAnswer(question: string, answer: TrustedAnswerGroup) {
  const value = answer.answer_value;
  if (!value) {
    return `I found ${answer.title}, but I need the proof source to confirm the exact answer.`;
  }

  if (looksLikeCredentialQuestion(question) || answer.answer_label.toLowerCase().includes("password")) {
    return `Your ${answer.title} ${answer.answer_label.toLowerCase()} is "${value}". Source: ${answer.main_source_title}.`;
  }

  return `${answer.answer_label}: ${value}. Source: ${answer.main_source_title}.`;
}

function rankMemoryCandidate(question: string, document: DecoderDocumentDetail): MemoryCandidate {
  const questionTokens = tokenize(question);
  const haystack = [
    document.document_type,
    document.document_category,
    document.storage_path,
    ...(document.memory_aliases ?? []),
    ...document.facts.flatMap((fact) => [
      fact.fact_type,
      fact.label,
      fact.fact_value,
      fact.source_text
    ])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let score = 0;
  for (const token of questionTokens) {
    if (haystack.includes(token)) score += token.length > 4 ? 2 : 1;
  }

  const answerFact = pickAnswerFact(question, document.facts);
  if (answerFact) score += 5;
  if (document.memory_aliases?.some((alias) => includesAny(alias, questionTokens))) score += 3;
  if (document.has_credential_facts && looksLikeCredentialQuestion(question)) score += 4;

  return { document, score, answerFact };
}

function pickAnswerFact(question: string, facts: DecoderFact[]) {
  const questionTokens = tokenize(question);
  const credentialQuestion = looksLikeCredentialQuestion(question);

  const ranked = facts
    .map((fact) => {
      const labelText = `${fact.fact_type} ${fact.label ?? ""}`.toLowerCase();
      const sourceText = (fact.source_text ?? "").toLowerCase();
      let score = 0;
      for (const token of questionTokens) {
        if (labelText.includes(token)) score += token.length > 4 ? 4 : 2;
        if (sourceText.includes(token)) score += 1;
      }
      if (credentialQuestion && includesAny(labelText, ["password", "credential"])) score += 20;
      if (credentialQuestion && includesAny(labelText, ["wifi", "wi-fi", "network"])) score += 6;
      if (credentialQuestion && includesAny(sourceText, ["password", "credential", "wifi", "wi-fi", "network"])) {
        score += 2;
      }
      if (fact.fact_value) score += 2;
      return { fact, score };
    })
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.score > 0 ? ranked[0].fact : facts.find((fact) => fact.fact_value) ?? null;
}

function buildAnswer(question: string, document: DecoderDocumentDetail, fact: DecoderFact | undefined | null) {
  const title = document.document_type ?? document.document_category ?? "the saved source";
  const label = fact?.label ?? fact?.fact_type ?? "saved fact";
  const value = fact?.fact_value;

  if (!value) return `I found a likely source: ${title}. Open the proof to confirm the exact answer.`;
  if (document.sensitive_info_locked) {
    return `I found ${label} in ${title}, but the value is locked until sensitive information is unlocked.`;
  }
  if (looksLikeCredentialQuestion(question)) return `${label}: ${value}. Source: ${title}.`;
  return `${value}. Source: ${title}.`;
}

function countDuplicateSources(target: DecoderDocumentDetail, documents: DecoderDocumentDetail[]) {
  const targetKey = duplicateKey(target);
  if (!targetKey) return 1;
  return documents.filter((document) => duplicateKey(document) === targetKey).length;
}

function duplicateKey(document: DecoderDocumentDetail) {
  const aliases = (document.memory_aliases ?? []).map((alias) => alias.toLowerCase()).sort().join("|");
  const credentialValues = document.facts
    .filter((fact) =>
      fact.fact_value &&
      includesAny(`${fact.fact_type} ${fact.label ?? ""}`, ["password", "credential", "wifi", "wi-fi"])
    )
    .map((fact) => fact.fact_value?.toLowerCase())
    .sort()
    .join("|");
  return credentialValues || aliases || document.document_type?.toLowerCase() || null;
}

function findSanitizedFact(target: DecoderFact | null, document: DecoderDocumentDetail) {
  if (!target) return null;
  return document.facts.find((fact) => fact.id === target.id) ?? null;
}

function looksLikeCredentialQuestion(question: string) {
  return includesAny(question, ["password", "wifi", "wi-fi", "network", "credential", "login", "code"]);
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function includesAny(value: string, tokens: string[]) {
  const lower = value.toLowerCase();
  return tokens.some((token) => lower.includes(token.toLowerCase()));
}
