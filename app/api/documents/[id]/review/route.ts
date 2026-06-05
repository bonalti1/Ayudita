import { NextResponse } from "next/server";
import { reviewDecoderDocument } from "@/lib/decoder-store";

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
