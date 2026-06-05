import { NextResponse } from "next/server";
import { sendReviewedExplanationToWhatsApp } from "@/lib/decoder-store";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const document = await sendReviewedExplanationToWhatsApp(id);
    return NextResponse.json({ document });
  } catch (error) {
    console.error("Failed to send reviewed explanation over WhatsApp.", error);

    const message = error instanceof Error ? error.message : "Failed to send WhatsApp message.";
    const status = message === "Document not found." ? 404 : 400;

    return NextResponse.json({ error: message }, { status });
  }
}
