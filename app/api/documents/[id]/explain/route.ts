import { NextResponse } from "next/server";
import { explainDecoderDocument } from "@/lib/decoder-store";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const document = await explainDecoderDocument(id);
    return NextResponse.json({ document });
  } catch (error) {
    console.error("Failed to explain decoder document.", error);

    const message = error instanceof Error ? error.message : "Failed to explain document.";
    const status = message === "Document not found." ? 404 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
