import { z } from "zod";

const provenanceSchema = z.enum(["VERBATIM", "COMPUTED", "INFERRED", "UNKNOWN"]);
const documentCategorySchema = z.enum([
  "letter_notice",
  "bill_invoice",
  "receipt",
  "contract",
  "blueprint_plan",
  "wifi_settings",
  "message_screenshot",
  "loan_document",
  "insurance_document",
  "real_estate_document",
  "screenshot",
  "identity_document",
  "form",
  "other",
  "unclear"
]);
const generalFactCategorySchema = z.enum([
  "identity",
  "date",
  "amount",
  "contact",
  "account",
  "address",
  "instruction",
  "status",
  "credential",
  "technical",
  "other"
]);

const factValueSchema = z.object({
  value: z.string().nullable(),
  provenance: provenanceSchema,
  source_text: z.string().nullable()
});

export const decoderExtractionSchema = z.object({
  language_detected: z.enum(["es", "en", "mixed"]),
  readability: z.enum(["clear", "partial", "poor"]),
  document_category: documentCategorySchema,
  document_type: factValueSchema,
  detected_purpose: factValueSchema,
  issuing_agency: factValueSchema,
  recipient_name: factValueSchema,
  case_or_receipt_number: factValueSchema,
  why_sent: factValueSchema,
  what_to_do: z.array(
    z.object({
      value: z.string(),
      provenance: z.enum(["VERBATIM", "INFERRED"]),
      source_text: z.string()
    })
  ),
  fees: factValueSchema,
  key_dates: z.array(
    z.object({
      label: z.enum(["hearing", "appointment", "filing_deadline", "response_deadline", "other"]),
      value: z.string(),
      provenance: provenanceSchema,
      source_text: z.string(),
      page_number: z.number().int().positive().default(1)
    })
  ),
  general_facts: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      category: generalFactCategorySchema,
      provenance: provenanceSchema,
      source_text: z.string(),
      page_number: z.number().int().positive().default(1)
    })
  ),
  unreadable_regions: z.array(z.string()),
  extraction_notes: z.string()
});

export type DecoderExtraction = z.infer<typeof decoderExtractionSchema>;

export const decoderExtractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "language_detected",
    "readability",
    "document_category",
    "document_type",
    "detected_purpose",
    "issuing_agency",
    "recipient_name",
    "case_or_receipt_number",
    "why_sent",
    "what_to_do",
    "fees",
    "key_dates",
    "general_facts",
    "unreadable_regions",
    "extraction_notes"
  ],
  properties: {
    language_detected: { type: "string", enum: ["es", "en", "mixed"] },
    readability: { type: "string", enum: ["clear", "partial", "poor"] },
    document_category: {
      type: "string",
      enum: [
        "letter_notice",
        "bill_invoice",
        "receipt",
        "contract",
        "blueprint_plan",
        "wifi_settings",
        "message_screenshot",
        "loan_document",
        "insurance_document",
        "real_estate_document",
        "screenshot",
        "identity_document",
        "form",
        "other",
        "unclear"
      ]
    },
    document_type: factValueJsonSchema(),
    detected_purpose: factValueJsonSchema(),
    issuing_agency: factValueJsonSchema(),
    recipient_name: factValueJsonSchema(),
    case_or_receipt_number: factValueJsonSchema(),
    why_sent: factValueJsonSchema(),
    what_to_do: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["value", "provenance", "source_text"],
        properties: {
          value: { type: "string" },
          provenance: { type: "string", enum: ["VERBATIM", "INFERRED"] },
          source_text: { type: "string" }
        }
      }
    },
    fees: factValueJsonSchema(),
    key_dates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value", "provenance", "source_text", "page_number"],
        properties: {
          label: {
            type: "string",
            enum: ["hearing", "appointment", "filing_deadline", "response_deadline", "other"]
          },
          value: { type: "string" },
          provenance: { type: "string", enum: ["VERBATIM", "COMPUTED", "INFERRED", "UNKNOWN"] },
          source_text: { type: "string" },
          page_number: { type: "integer", minimum: 1 }
        }
      }
    },
    general_facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value", "category", "provenance", "source_text", "page_number"],
        properties: {
          label: { type: "string" },
          value: { type: "string" },
          category: {
            type: "string",
            enum: [
              "identity",
              "date",
              "amount",
              "contact",
              "account",
              "address",
              "instruction",
              "status",
              "credential",
              "technical",
              "other"
            ]
          },
          provenance: { type: "string", enum: ["VERBATIM", "COMPUTED", "INFERRED", "UNKNOWN"] },
          source_text: { type: "string" },
          page_number: { type: "integer", minimum: 1 }
        }
      }
    },
    unreadable_regions: {
      type: "array",
      items: { type: "string" }
    },
    extraction_notes: { type: "string" }
  }
} as const;

function factValueJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["value", "provenance", "source_text"],
    properties: {
      value: { type: ["string", "null"] },
      provenance: { type: "string", enum: ["VERBATIM", "COMPUTED", "INFERRED", "UNKNOWN"] },
      source_text: { type: ["string", "null"] }
    }
  } as const;
}
