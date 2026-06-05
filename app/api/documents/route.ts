import { NextResponse } from "next/server";
import { listDecoderDocuments } from "@/lib/decoder-store";
import { isReviewerUnlocked } from "@/lib/reviewer-auth";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { hasSensitiveFacts, sanitizeDocumentSummaries } from "@/lib/sensitive-documents";

export async function GET(request: Request) {
  try {
    const documents = await listDecoderDocuments();
    const sensitiveDocumentIds = await getSensitiveDocumentIds(documents.map((document) => document.id));

    return NextResponse.json({
      documents: sanitizeDocumentSummaries(
        documents,
        sensitiveDocumentIds,
        isReviewerUnlocked(request)
      )
    });
  } catch (error) {
    console.error("Failed to list decoder documents.", error);
    return NextResponse.json({ error: "Failed to list documents." }, { status: 500 });
  }
}

async function getSensitiveDocumentIds(documentIds: string[]) {
  if (!documentIds.length) return new Set<string>();

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("facts")
    .select("document_id,fact_type,label")
    .in("document_id", documentIds);

  if (error) throw error;

  const grouped = new Map<string, Array<{ fact_type: string; label: string | null }>>();
  for (const fact of data ?? []) {
    const facts = grouped.get(fact.document_id) ?? [];
    facts.push({ fact_type: fact.fact_type, label: fact.label });
    grouped.set(fact.document_id, facts);
  }

  return new Set(
    [...grouped.entries()]
      .filter(([, facts]) => hasSensitiveFacts(facts))
      .map(([documentId]) => documentId)
  );
}
