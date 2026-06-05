import { NextResponse } from "next/server";
import { getDecoderDocument, sendReviewedExplanationToWhatsApp } from "@/lib/decoder-store";
import { isReviewerUnlocked } from "@/lib/reviewer-auth";
import { hasSensitiveFacts } from "@/lib/sensitive-documents";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const existingDocument = await getDecoderDocument(id);

    if (!existingDocument) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    if (hasSensitiveFacts(existingDocument.facts) && !isReviewerUnlocked(request)) {
      return NextResponse.json(
        { error: "Unlock sensitive information before sending this WhatsApp reply." },
        { status: 403 }
      );
    }

    const document = await sendReviewedExplanationToWhatsApp(id);
    return NextResponse.json({ document });
  } catch (error) {
    console.error("Failed to send reviewed explanation over WhatsApp.", error);

    const message = error instanceof Error ? error.message : "Failed to send WhatsApp message.";
    const status = message === "Document not found." ? 404 : 400;

    return NextResponse.json({ error: message }, { status });
  }
}
