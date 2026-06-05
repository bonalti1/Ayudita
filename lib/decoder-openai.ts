import { createOpenAIClient } from "./openai";
import { decoderExtractionJsonSchema, decoderExtractionSchema } from "./decoder-extraction-schema";
import type { DecoderExtraction } from "./decoder-extraction-schema";
import { EXPLAIN_MODEL, EXPLANATION_PROMPT, EXTRACT_MODEL, EXTRACTION_PROMPT } from "./decoder-prompts";
import type { DecoderFact } from "./decoder-types";

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
