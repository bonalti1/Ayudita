import { NextResponse } from "next/server";
import { createRawDocumentSignedUrl, getDecoderDocument } from "@/lib/decoder-store";
import { isReviewerUnlocked } from "@/lib/reviewer-auth";
import { sanitizeDocumentDetail } from "@/lib/sensitive-documents";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const document = await getDecoderDocument(id);

    if (!document) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    const sanitizedDocument = sanitizeDocumentDetail(document, isReviewerUnlocked(request));
    const sourceUrl = sanitizedDocument.sensitive_info_locked
      ? null
      : await createRawDocumentSignedUrl(document);

    return NextResponse.json({
      document: {
        ...sanitizedDocument,
        source_url: sourceUrl
      }
    });
  } catch (error) {
    console.error("Failed to get decoder document.", error);
    return NextResponse.json({ error: "Failed to get document." }, { status: 500 });
  }
}
