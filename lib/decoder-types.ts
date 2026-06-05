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
  has_sensitive_info?: boolean;
  sensitive_info_locked?: boolean;
  has_credential_facts?: boolean;
  memory_aliases?: string[];
  memory_disabled?: boolean;
  memory_last_used_at?: string | null;
  memory_use_count?: number;
  trusted_answer_primary?: boolean;
  trusted_answer_primary_at?: string | null;
  source_request_count?: number;
};

export type DecoderDocumentDetail = DecoderDocument & {
  facts: DecoderFact[];
  explanations: DecoderExplanation[];
  document_text: DecoderDocumentText | null;
  source_url?: string | null;
  has_sensitive_info?: boolean;
  sensitive_info_locked?: boolean;
  has_credential_facts?: boolean;
  memory_aliases?: string[];
  memory_disabled?: boolean;
  memory_last_used_at?: string | null;
  memory_use_count?: number;
  trusted_answer_primary?: boolean;
  trusted_answer_primary_at?: string | null;
  source_request_count?: number;
};
