import { createOpenAIClient } from "./openai";
import { decoderExtractionJsonSchema, decoderExtractionSchema } from "./decoder-extraction-schema";
import type { DecoderExtraction } from "./decoder-extraction-schema";
import {
  EXPLAIN_MODEL,
  EXPLANATION_PROMPT,
  EXTRACT_MODEL,
  FULL_DOCUMENT_FOLLOW_UP_PROMPT,
  EXTRACTION_PROMPT,
  FOLLOW_UP_PROMPT
} from "./decoder-prompts";
import type { DecoderExplanation, DecoderFact } from "./decoder-types";

type ExtractDocumentInput = {
  bytes: ArrayBuffer;
  mimeType: string;
  fileName: string;
};

export async function extractFactsWithOpenAI(input: ExtractDocumentInput): Promise<{
  extraction: DecoderExtraction;
  model: string;
}> {
  const client = createOpenAIClient();
  const base64 = Buffer.from(input.bytes).toString("base64");
  const content = buildInputContent(input.mimeType, base64, input.fileName);

  const response = await client.responses.create({
    model: EXTRACT_MODEL,
    input: [
      {
        role: "user",
        content: [
          ...content,
          {
            type: "input_text",
            text: EXTRACTION_PROMPT
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "ayudita_document_extraction",
        strict: false,
        schema: decoderExtractionJsonSchema
      }
    }
  });

  const text = response.output_text;
  if (!text) {
    throw new Error("OpenAI returned an empty extraction response.");
  }

  const parsed = decoderExtractionSchema.parse(JSON.parse(text));
  return { extraction: parsed, model: EXTRACT_MODEL };
}

export async function explainFactsWithOpenAI(input: {
  facts: DecoderFact[];
  language?: string | null;
}): Promise<{ body: string; model: string }> {
  const client = createOpenAIClient();

  const response = await client.responses.create({
    model: EXPLAIN_MODEL,
    instructions: EXPLANATION_PROMPT,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              language: input.language ?? "es",
              facts: input.facts.map((fact) => ({
                fact_type: fact.fact_type,
                label: fact.label,
                fact_value: fact.fact_value,
                provenance_type: fact.provenance_type,
                source_text: fact.source_text,
                page_number: fact.page_number
              }))
            })
          }
        ]
      }
    ]
  });

  const body = response.output_text?.trim();
  if (!body) {
    throw new Error("OpenAI returned an empty explanation response.");
  }

  return { body, model: EXPLAIN_MODEL };
}

export async function answerFollowUpWithOpenAI(input: {
  question: string;
  targetLanguage: "en" | "es";
  facts: DecoderFact[];
  explanations: DecoderExplanation[];
}): Promise<{ body: string; model: string }> {
  const client = createOpenAIClient();
  const matchingExplanations = input.explanations.filter(
    (explanation) => explanation.language === input.targetLanguage
  );

  const response = await client.responses.create({
    model: EXPLAIN_MODEL,
    instructions: FOLLOW_UP_PROMPT,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              question: input.question,
              target_language: input.targetLanguage,
              facts: input.facts.map((fact) => ({
                fact_type: fact.fact_type,
                label: fact.label,
                fact_value: fact.fact_value,
                provenance_type: fact.provenance_type,
                source_text: fact.source_text,
                page_number: fact.page_number
              })),
              explanations: matchingExplanations.map((explanation) => ({
                language: explanation.language,
                body: explanation.body
              }))
            })
          }
        ]
      }
    ]
  });

  const body = sanitizeDecisionLanguage(response.output_text?.trim() ?? "", input.targetLanguage);
  if (!body) {
    throw new Error("OpenAI returned an empty follow-up response.");
  }

  return { body, model: EXPLAIN_MODEL };
}

export async function answerFullDocumentQuestionWithOpenAI(input: {
  bytes: ArrayBuffer;
  mimeType: string;
  fileName: string;
  question: string;
  targetLanguage: "en" | "es";
  facts: DecoderFact[];
  explanations: DecoderExplanation[];
}): Promise<{ body: string; model: string }> {
  const client = createOpenAIClient();
  const base64 = Buffer.from(input.bytes).toString("base64");
  const content = buildInputContent(input.mimeType, base64, input.fileName);
  const matchingExplanations = input.explanations.filter(
    (explanation) => explanation.language === input.targetLanguage
  );

  const response = await client.responses.create({
    model: EXTRACT_MODEL,
    instructions: FULL_DOCUMENT_FOLLOW_UP_PROMPT,
    input: [
      {
        role: "user",
        content: [
          ...content,
          {
            type: "input_text",
            text: JSON.stringify({
              question: input.question,
              target_language: input.targetLanguage,
              saved_facts: input.facts.map((fact) => ({
                fact_type: fact.fact_type,
                label: fact.label,
                fact_value: fact.fact_value,
                provenance_type: fact.provenance_type,
                source_text: fact.source_text,
                page_number: fact.page_number
              })),
              saved_explanations: matchingExplanations.map((explanation) => ({
                language: explanation.language,
                body: explanation.body
              }))
            })
          }
        ]
      }
    ]
  });

  const body = sanitizeDecisionLanguage(response.output_text?.trim() ?? "", input.targetLanguage);
  if (!body) {
    throw new Error("OpenAI returned an empty full-document follow-up response.");
  }

  return { body, model: EXTRACT_MODEL };
}

function sanitizeDecisionLanguage(body: string, language: "en" | "es") {
  if (!body) return body;

  if (language === "en") {
    return body
      .replace(/\b[Tt]he document says you need to pay\b/g, "The document says the amount due is")
      .replace(/\b[Tt]he document says you have to pay\b/g, "The document says the amount due is")
      .replace(/\b[Tt]he document says you must pay\b/g, "The document says the amount due is")
      .replace(/\b[Tt]he document says you need to\b/g, "The document asks you to")
      .replace(/\b[Tt]he document says you have to\b/g, "The document asks you to")
      .replace(/\b[Tt]he document says you must\b/g, "The document asks you to")
      .replace(/\b[Yy]ou need to pay\b/g, "The document says the amount due is")
      .replace(/\b[Yy]ou have to pay\b/g, "The document says the amount due is")
      .replace(/\b[Yy]ou must pay\b/g, "The document says the amount due is")
      .replace(/\b[Yy]ou need to\b/g, "The document asks you to")
      .replace(/\b[Yy]ou have to\b/g, "The document asks you to")
      .replace(/\b[Yy]ou must\b/g, "The document asks you to");
  }

  return body
    .replace(/\b[Dd]ebes pagar\b/g, "El documento dice que el monto a pagar es")
    .replace(/\b[Tt]ienes que pagar\b/g, "El documento dice que el monto a pagar es")
    .replace(/\b[Dd]ebes\b/g, "El documento pide")
    .replace(/\b[Tt]ienes que\b/g, "El documento pide");
}

function buildInputContent(mimeType: string, base64: string, fileName: string) {
  if (mimeType === "application/pdf") {
    return [
      {
        type: "input_file" as const,
        filename: fileName || "document.pdf",
        file_data: `data:${mimeType};base64,${base64}`
      }
    ];
  }

  return [
    {
      type: "input_image" as const,
      image_url: `data:${mimeType};base64,${base64}`,
      detail: "high" as const
    }
  ];
}
