export type DocumentStatus = "received" | "extracted" | "explained" | "failed";
export type ReviewStatus = "pending" | "reviewed" | "flagged";
export type DocumentSource = "whatsapp" | "web";

export type DecoderDocument = {
  id: string;
  user_phone: string;
  created_at: string;
  storage_path: string;
  source: DocumentSource;
  mime_type: string | null;
  document_type: string | null;
  document_category: string | null;
  language: string | null;
  review_status: ReviewStatus;
  status: DocumentStatus;
};

export type DecoderFact = {
  id: string;
  document_id: string;
  created_at: string;
  fact_type: string;
  label: string | null;
  fact_value: string | null;
  provenance_type: string;
  source_text: string | null;
  page_number: number | null;
  model: string | null;
};

export type DecoderExplanation = {
  id: string;
  document_id: string;
  created_at: string;
  language: string;
  body: string | null;
  model: string | null;
};

export type DecoderDocumentText = {
  document_id: string;
  raw_text: string | null;
  language: string | null;
  extraction_model: string | null;
  created_at: string;
};

export type DecoderDocumentSummary = DecoderDocument & {
  latest_explanation: DecoderExplanation | null;
  facts_count: number;
};

export type DecoderDocumentDetail = DecoderDocument & {
  facts: DecoderFact[];
  explanations: DecoderExplanation[];
  document_text: DecoderDocumentText | null;
};
