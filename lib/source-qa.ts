import { listDecoderDocuments } from "./decoder-store";
import { querySavedMemory } from "./memory-query";

type SourceQaStatus = "pass" | "warn" | "fail";

export type SourceQaCheck = {
  id: string;
  title: string;
  status: SourceQaStatus;
  detail: string;
  customerImpact: string;
};

export type SourceQaReport = {
  generated_at: string;
  summary: {
    total: number;
    pass: number;
    warn: number;
    fail: number;
  };
  source_counts: {
    total: number;
    drive: number;
    whatsapp: number;
    uploads: number;
    remembered: number;
    failed: number;
    contract_like: number;
    contract_classified: number;
  };
  checks: SourceQaCheck[];
};

export async function runSourceQaBatch(input: { isUnlocked?: boolean } = {}): Promise<SourceQaReport> {
  const documents = await listDecoderDocuments();
  const checks: SourceQaCheck[] = [];
  const rememberedDocuments = documents.filter(
    (document) => document.status === "extracted" || document.status === "explained"
  );
  const contractLikeDocuments = documents.filter(looksLikeContractDocument);
  const contractClassifiedDocuments = documents.filter((document) => document.document_category === "contract");
  const wifiLikeDocuments = documents.filter(
    (document) =>
      document.has_credential_facts ||
      mentionsAny(documentSearchText(document), ["wifi", "wi fi", "password", "network", "ssid"])
  );
  const tollLikeDocuments = documents.filter((document) =>
    mentionsAny(documentSearchText(document), ["toll", "tolls", "hctra", "ccrma", "peaje", "peajes"])
  );

  checks.push({
    id: "source-library-populated",
    title: "Source library is populated",
    status: documents.length > 0 ? "pass" : "fail",
    detail: documents.length > 0 ? `${documents.length} sources are saved.` : "No source documents are saved yet.",
    customerImpact:
      "Customers can only trust Ayudita if the original images, PDFs, or files are saved first."
  });

  checks.push({
    id: "source-extraction-ready",
    title: "Saved sources have extracted memory",
    status: rememberedDocuments.length >= Math.max(1, Math.floor(documents.length * 0.7)) ? "pass" : "warn",
    detail: `${rememberedDocuments.length} of ${documents.length} sources are remembered or answer-ready.`,
    customerImpact:
      "The more files that are remembered, the less often the customer gets a vague or empty answer."
  });

  checks.push({
    id: "drive-source-coverage",
    title: "Drive source coverage",
    status: documents.some((document) => document.source === "drive") ? "pass" : "warn",
    detail: documents.some((document) => document.source === "drive")
      ? "Google Drive sources are available."
      : "No Google Drive sources are currently imported.",
    customerImpact:
      "Drive coverage matters because teams should not need to resend every document through WhatsApp."
  });

  checks.push({
    id: "contract-classification",
    title: "Contract classification health",
    status:
      contractLikeDocuments.length === 0 || contractClassifiedDocuments.length >= contractLikeDocuments.length
        ? "pass"
        : "warn",
    detail:
      contractLikeDocuments.length === 0
        ? "No contract-like documents found in the current source library."
        : `${contractClassifiedDocuments.length} of ${contractLikeDocuments.length} contract-like sources are classified as contracts.`,
    customerImpact:
      "Contract questions need contract behavior: counts, locations, included/excluded items, and exact nearby wording."
  });

  if (contractLikeDocuments.length > 0) {
    const contractProbe = await querySavedMemory({
      question: "Where in the contract does it mention ceiling designs?",
      isUnlocked: input.isUnlocked
    });
    const safeContractRouting =
      contractProbe.answer === null &&
      contractProbe.answer_source === "document" &&
      Boolean(contractProbe.document?.id);

    checks.push({
      id: "contract-deep-question-routing",
      title: "Deep contract questions avoid shallow answers",
      status: safeContractRouting ? "pass" : "fail",
      detail: safeContractRouting
        ? `Deep contract question routes to source document: ${contractProbe.document?.title ?? "source"}.`
        : "Deep contract question may still be answered from one unrelated saved fact.",
      customerImpact:
        "This prevents bad answers like returning the contract price when the customer asked about ceiling designs."
    });
  } else {
    checks.push({
      id: "contract-deep-question-routing",
      title: "Deep contract questions avoid shallow answers",
      status: "warn",
      detail: "No contract-like document is available to test this scenario.",
      customerImpact:
        "Add real contracts to test whether Ayudita can answer location and count questions with proof."
    });
  }

  if (wifiLikeDocuments.length > 0) {
    const wifiProbe = await querySavedMemory({
      question: "What is my office WiFi password?",
      isUnlocked: input.isUnlocked
    });
    checks.push({
      id: "wifi-trusted-answer",
      title: "WiFi trusted answer still works",
      status: wifiProbe.answer && wifiProbe.confidence !== "low" && wifiProbe.confidence !== "none" ? "pass" : "fail",
      detail: wifiProbe.answer
        ? `WiFi question returned a ${wifiProbe.confidence}-confidence answer from ${wifiProbe.answer_source ?? "memory"}.`
        : "WiFi question did not return a usable answer.",
      customerImpact:
        "Fast exact answers are the magic moment, especially for credentials where the customer expects certainty."
    });
  } else {
    checks.push({
      id: "wifi-trusted-answer",
      title: "WiFi trusted answer still works",
      status: "warn",
      detail: "No WiFi-like source is available to test.",
      customerImpact:
        "Credentials are a high-trust use case. Add WiFi screenshots to keep testing this experience."
    });
  }

  if (tollLikeDocuments.length > 1) {
    const tollProbe = await querySavedMemory({
      question: "What toll bill do I owe?",
      isUnlocked: input.isUnlocked
    });
    const avoidsOverAnswer = tollProbe.answer === null || tollProbe.confidence === "none";
    checks.push({
      id: "ambiguous-toll-question",
      title: "Ambiguous bill questions do not over-answer",
      status: avoidsOverAnswer ? "pass" : "warn",
      detail: avoidsOverAnswer
        ? "Broad toll question asks for clarification instead of choosing the wrong bill."
        : "Broad toll question may choose one bill too quickly.",
      customerImpact:
        "When many similar bills exist, the best experience is to ask which one before giving a confident answer."
    });
  } else {
    checks.push({
      id: "ambiguous-toll-question",
      title: "Ambiguous bill questions do not over-answer",
      status: "warn",
      detail: "Not enough toll/bill sources are available to test ambiguity.",
      customerImpact:
        "Ambiguity testing keeps Ayudita from sounding confident when several sources could match."
    });
  }

  const summary = summarizeChecks(checks);

  return {
    generated_at: new Date().toISOString(),
    summary,
    source_counts: {
      total: documents.length,
      drive: documents.filter((document) => document.source === "drive").length,
      whatsapp: documents.filter((document) => document.source === "whatsapp").length,
      uploads: documents.filter((document) => document.source === "web").length,
      remembered: rememberedDocuments.length,
      failed: documents.filter((document) => document.status === "failed").length,
      contract_like: contractLikeDocuments.length,
      contract_classified: contractClassifiedDocuments.length
    },
    checks
  };
}

function summarizeChecks(checks: SourceQaCheck[]) {
  return {
    total: checks.length,
    pass: checks.filter((check) => check.status === "pass").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length
  };
}

function looksLikeContractDocument(document: {
  document_type: string | null;
  document_category: string | null;
  storage_path: string;
}) {
  const text = documentSearchText(document);
  if (mentionsAny(text, ["contract", "agreement", "contrato", "acuerdo"])) return true;
  return mentionsAny(text, [
    "residential construction",
    "construction",
    "builder",
    "contractor",
    "owner",
    "allowance",
    "scope",
    "warranty",
    "signature",
    "construccion",
    "constructor",
    "contratista",
    "alcance",
    "garantia",
    "firma"
  ]);
}

function documentSearchText(document: {
  document_type: string | null;
  document_category: string | null;
  storage_path: string;
}) {
  return normalizeForSearch([document.document_type, document.document_category, document.storage_path].filter(Boolean).join(" "));
}

function mentionsAny(value: string, words: string[]) {
  return words.some((word) => value.includes(normalizeForSearch(word)));
}

function normalizeForSearch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, " ")
    .trim();
}
