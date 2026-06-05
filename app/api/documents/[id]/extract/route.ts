import { NextResponse } from "next/server";
import { extractDecoderDocument } from "@/lib/decoder-store";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const document = await extractDecoderDocument(id);
    return NextResponse.json({ document });
  } catch (error) {
    console.error("Failed to extract decoder document.", error);

    const message = error instanceof Error ? error.message : "Failed to extract document.";
    const status = message === "Document not found." ? 404 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
