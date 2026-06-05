import { NextResponse } from "next/server";
import { getDecoderDocument, reviewDecoderDocument } from "@/lib/decoder-store";
import { isReviewerUnlocked } from "@/lib/reviewer-auth";
import { hasSensitiveFacts } from "@/lib/sensitive-documents";

export const runtime = "nodejs";

const REVIEW_ACTIONS = new Set(["approve", "flag", "clearer_photo", "reset"]);

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as { action?: string } | null;

    if (!body?.action || !REVIEW_ACTIONS.has(body.action)) {
      return NextResponse.json({ error: "Invalid review action." }, { status: 400 });
    }

    if (body.action === "approve") {
      const existingDocument = await getDecoderDocument(id);

      if (!existingDocument) {
        return NextResponse.json({ error: "Document not found." }, { status: 404 });
      }

      if (hasSensitiveFacts(existingDocument.facts) && !isReviewerUnlocked(request)) {
        return NextResponse.json(
          { error: "Unlock sensitive information before approving this explanation." },
          { status: 403 }
        );
      }
    }

    const document = await reviewDecoderDocument(
      id,
      body.action as "approve" | "flag" | "clearer_photo" | "reset"
    );

    return NextResponse.json({ document });
  } catch (error) {
    console.error("Failed to review decoder document.", error);

    const message = error instanceof Error ? error.message : "Failed to review document.";
    const status = message === "Document not found." ? 404 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
