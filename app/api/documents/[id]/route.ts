import { NextResponse } from "next/server";
import { getDecoderDocument } from "@/lib/decoder-store";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const document = await getDecoderDocument(id);

    if (!document) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    return NextResponse.json({ document });
  } catch (error) {
    console.error("Failed to get decoder document.", error);
    return NextResponse.json({ error: "Failed to get document." }, { status: 500 });
  }
}
