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

    const message = errorMessage(error);
    const status = message === "Document not found." ? 404 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Failed to extract document.";
}
