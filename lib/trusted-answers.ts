import { getDecoderDocument, listDecoderDocuments } from "./decoder-store";
import { sanitizeDocumentDetail } from "./sensitive-documents";
import type { DecoderDocumentDetail, DecoderFact } from "./decoder-types";

export type TrustedAnswerSource = {
  document_id: string;
  title: string;
  created_at: string;
  mime_type: string | null;
  source: string;
  source_sent_count: number;
  memory_use_count: number;
  is_main: boolean;
};

export type TrustedAnswerGroup = {
  id: string;
  title: string;
  answer_label: string;
  answer_value: string | null;
  answer_source_text: string | null;
  confidence: "high" | "medium" | "low";
  aliases: string[];
  source_count: number;
  source_sent_count: number;
  memory_use_count: number;
  last_used_at: string | null;
  main_document_id: string;
  main_source_title: string;
  proof_type: "image" | "pdf" | "document";
  sources: TrustedAnswerSource[];
};

type GroupDraft = {
  key: string;
  documents: DecoderDocumentDetail[];
};

export async function listTrustedAnswers(input: { isUnlocked?: boolean; userPhone?: string } = {}) {
  const summaries = await listDecoderDocuments();
  const candidates = summaries
    .filter(
      (document) =>
        (!input.userPhone || document.user_phone === input.userPhone) &&
        !document.memory_disabled &&
        (document.status === "extracted" || document.status === "explained") &&
        (document.memory_aliases?.length || document.has_credential_facts || document.facts_count > 0)
    )
    .slice(0, 50);

  const documents = (
    await Promise.all(candidates.map((document) => getDecoderDocument(document.id)))
  ).filter((document): document is DecoderDocumentDetail => Boolean(document?.facts.length));

  const drafts = groupDocuments(documents);
  return drafts
    .map((draft) => trustedAnswerFromDraft(draft, Boolean(input.isUnlocked)))
    .filter((group): group is TrustedAnswerGroup => Boolean(group))
    .sort((a, b) => {
      if (b.memory_use_count !== a.memory_use_count) return b.memory_use_count - a.memory_use_count;
      return new Date(b.sources[0]?.created_at ?? 0).getTime() - new Date(a.sources[0]?.created_at ?? 0).getTime();
    });
}

function groupDocuments(documents: DecoderDocumentDetail[]) {
  const groups = new Map<string, GroupDraft>();

  for (const document of documents) {
    const key = trustedAnswerKey(document);
    const draft = groups.get(key) ?? { key, documents: [] };
    draft.documents.push(document);
    groups.set(key, draft);
  }

  return [...groups.values()];
}

function trustedAnswerFromDraft(draft: GroupDraft, isUnlocked: boolean): TrustedAnswerGroup | null {
  const sortedDocuments = [...draft.documents].sort(compareDocumentsForMainSource);
  const rawMainDocument = sortedDocuments[0];
  if (!rawMainDocument) return null;

  const mainDocument = sanitizeDocumentDetail(rawMainDocument, isUnlocked);
  const answerFact = pickTrustedFact(mainDocument.facts);
  if (!answerFact?.fact_value) return null;

  const aliases = unique(sortedDocuments.flatMap((document) => document.memory_aliases ?? []).filter(isUsefulAlias));
  const sourceSentCount = sortedDocuments.reduce((total, document) => total + (document.source_request_count ?? 0), 0);
  const memoryUseCount = sortedDocuments.reduce((total, document) => total + (document.memory_use_count ?? 0), 0);
  const lastUsedAt = latestDate(
    sortedDocuments
      .map((document) => document.memory_last_used_at)
      .filter((value): value is string => typeof value === "string" && Boolean(value))
  );

  return {
    id: draft.key,
    title: trustedAnswerTitle(mainDocument, aliases, answerFact),
    answer_label: formatAnswerLabel(answerFact),
    answer_value: answerFact?.fact_value ?? null,
    answer_source_text: answerFact?.source_text ?? null,
    confidence: sortedDocuments.length > 1 || mainDocument.has_credential_facts ? "high" : "medium",
    aliases,
    source_count: sortedDocuments.length,
    source_sent_count: sourceSentCount,
    memory_use_count: memoryUseCount,
    last_used_at: lastUsedAt,
    main_document_id: mainDocument.id,
    main_source_title: documentTitle(mainDocument),
    proof_type: proofType(mainDocument),
    sources: sortedDocuments.map((document, index) => ({
      document_id: document.id,
      title: documentTitle(document),
      created_at: document.created_at,
      mime_type: document.mime_type,
      source: document.source,
      source_sent_count: document.source_request_count ?? 0,
      memory_use_count: document.memory_use_count ?? 0,
      is_main: index === 0
    }))
  } satisfies TrustedAnswerGroup;
}

function trustedAnswerKey(document: DecoderDocumentDetail) {
  const credentialKey = credentialMemoryKey(document);
  if (credentialKey) return credentialKey;

  const aliases = (document.memory_aliases ?? []).filter(isUsefulAlias).map(normalizeText).filter(Boolean).sort();
  if (aliases.length) return `alias:${aliases.join("|")}`;

  const title = normalizeText(document.document_type ?? document.document_category ?? document.storage_path);
  return `document:${title}`;
}

function credentialMemoryKey(document: DecoderDocumentDetail) {
  const password = factValue(document.facts, ["password", "credential", "contrasena", "clave"]);
  const network = factValue(document.facts, ["network name", "ssid", "wi-fi network", "wifi network"]);
  const alias = (document.memory_aliases ?? []).map(normalizeText).find(Boolean);

  if (password) return `credential:password:${password}`;
  if (alias && network) return `credential:${alias}:wifi:${network}`;
  if (network) return `credential:wifi:${network}`;
  return null;
}

function factValue(facts: DecoderFact[], signals: string[]) {
  for (const fact of facts) {
    const label = normalizeText(`${fact.fact_type} ${fact.label ?? ""}`);
    if (!signals.some((signal) => label.includes(signal))) continue;
    const value = normalizeText(fact.fact_value ?? "");
    if (value && !["password", "network", "wifi", "wi fi", "automatic", "fixed"].includes(value)) {
      return value;
    }
  }
  return null;
}

function pickTrustedFact(facts: DecoderFact[]) {
  return facts
    .filter((fact) => fact.fact_value)
    .sort((a, b) => factImportance(b) - factImportance(a))[0] ?? null;
}

function factImportance(fact: DecoderFact) {
  const text = normalizeText(`${fact.fact_type} ${fact.label ?? ""}`);
  if (text.includes("password") || text.includes("credential")) return 100;
  if (text.includes("amount") || text.includes("due") || text.includes("fee")) return 80;
  if (text.includes("case") || text.includes("invoice") || text.includes("account")) return 70;
  if (text.includes("name") || text.includes("network")) return 60;
  if (fact.fact_value) return 10;
  return 0;
}

function trustedAnswerTitle(document: DecoderDocumentDetail, aliases: string[], fact: DecoderFact | null) {
  const alias = aliases[0];
  const label = normalizeText(`${fact?.fact_type ?? ""} ${fact?.label ?? ""}`);

  if (alias && label.includes("password")) return `${titleCase(alias)} WiFi`;
  if (alias) return titleCase(alias);
  if (label.includes("password")) return "WiFi Password";
  if (label.includes("amount") || label.includes("fee")) return documentTitle(document);
  return documentTitle(document);
}

function formatAnswerLabel(fact: DecoderFact | null) {
  const rawLabel = fact?.label ?? fact?.fact_type ?? "Saved answer";
  const normalized = normalizeText(rawLabel);

  if (normalized.includes("password") || normalized.includes("credential")) return "Password";
  if (normalized.includes("amount") || normalized.includes("fee") || normalized.includes("due")) return "Amount due";
  if (normalized.includes("invoice")) return "Invoice number";
  if (normalized.includes("account")) return "Account";
  if (normalized.includes("network") || normalized.includes("ssid")) return "Network";

  return titleCase(rawLabel.replace(/[_:]+/g, " "));
}

function documentTitle(document: DecoderDocumentDetail) {
  if (document.document_type) return document.document_type;
  if (document.document_category) return titleCase(document.document_category.replace(/_/g, " "));
  return document.storage_path.split("/").pop()?.replace(/^\d+-[a-f0-9-]+-/i, "") ?? "Saved document";
}

function compareDocumentsForMainSource(a: DecoderDocumentDetail, b: DecoderDocumentDetail) {
  const bScore = (b.memory_use_count ?? 0) * 10 + (b.source_request_count ?? 0) * 5;
  const aScore = (a.memory_use_count ?? 0) * 10 + (a.source_request_count ?? 0) * 5;
  if (bScore !== aScore) return bScore - aScore;
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

function proofType(document: DecoderDocumentDetail) {
  if (document.mime_type?.startsWith("image/")) return "image";
  if (document.mime_type === "application/pdf") return "pdf";
  return "document";
}

function latestDate(values: string[]) {
  if (!values.length) return null;
  return values.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, " ")
    .trim();
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isUsefulAlias(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  if (["yes", "no", "ok", "okay", "thanks", "thank you", "mine", "me", "my"].includes(normalized)) {
    return false;
  }
  return normalized.length >= 4;
}
