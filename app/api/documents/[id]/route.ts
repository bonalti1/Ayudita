import { NextResponse } from "next/server";
import { getDecoderDocument } from "@/lib/decoder-store";
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

    return NextResponse.json({
      document: sanitizeDocumentDetail(document, isReviewerUnlocked(request))
    });
  } catch (error) {
    console.error("Failed to get decoder document.", error);
    return NextResponse.json({ error: "Failed to get document." }, { status: 500 });
  }
}
