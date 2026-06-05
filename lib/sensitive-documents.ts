import type { DecoderDocumentDetail, DecoderDocumentSummary, DecoderFact } from "./decoder-types";

const SENSITIVE_PATTERNS = [
  "credential",
  "password",
  "account",
  "address",
  "code",
  "token",
  "api key",
  "private key",
  "ssn",
  "social security",
  "card number"
];

export function isSensitiveFact(fact: Pick<DecoderFact, "fact_type" | "label">) {
  const text = `${fact.fact_type} ${fact.label ?? ""}`.toLowerCase();
  return SENSITIVE_PATTERNS.some((pattern) => text.includes(pattern));
}

export function hasSensitiveFacts(facts: Array<Pick<DecoderFact, "fact_type" | "label">>) {
  return facts.some(isSensitiveFact);
}

export function sanitizeDocumentDetail(
  document: DecoderDocumentDetail,
  isUnlocked: boolean
): DecoderDocumentDetail & { has_sensitive_info: boolean; sensitive_info_locked: boolean } {
  const hasSensitiveInfo = hasSensitiveFacts(document.facts);
  const sensitiveInfoLocked = hasSensitiveInfo && !isUnlocked;

  if (!sensitiveInfoLocked) {
    return {
      ...document,
      has_sensitive_info: hasSensitiveInfo,
      sensitive_info_locked: false
    };
  }

  return {
    ...document,
    facts: document.facts.map((fact) =>
      isSensitiveFact(fact)
        ? {
            ...fact,
            fact_value: maskSensitiveValue(fact.fact_value),
            source_text: fact.source_text ? "Sensitive source text hidden until reviewer unlock." : null
          }
        : fact
    ),
    explanations: document.explanations.map((explanation) => ({
      ...explanation,
      body: explanation.body
        ? "Esta explicación contiene información sensible. Ingresa la contraseña de revisión para verla."
        : explanation.body
    })),
    has_sensitive_info: true,
    sensitive_info_locked: true
  };
}

export function sanitizeDocumentSummaries(
  documents: DecoderDocumentSummary[],
  sensitiveDocumentIds: Set<string>,
  isUnlocked: boolean
) {
  return documents.map((document) => {
    const hasSensitiveInfo = sensitiveDocumentIds.has(document.id);
    const sensitiveInfoLocked = hasSensitiveInfo && !isUnlocked;

    return {
      ...document,
      latest_explanation:
        sensitiveInfoLocked && document.latest_explanation?.body
          ? {
              ...document.latest_explanation,
              body: "Explicación sensible oculta hasta ingresar la contraseña de revisión."
            }
          : document.latest_explanation,
      has_sensitive_info: hasSensitiveInfo,
      sensitive_info_locked: sensitiveInfoLocked
    };
  });
}

function maskSensitiveValue(value: string | null) {
  if (!value) return value;
  if (value.length <= 4) return "••••";
  return `${value.slice(0, 2)}••••${value.slice(-2)}`;
}
