import { NextResponse } from "next/server";
import { listDecoderDocuments } from "@/lib/decoder-store";

export async function GET() {
  try {
    const documents = await listDecoderDocuments();
    return NextResponse.json({ documents });
  } catch (error) {
    console.error("Failed to list decoder documents.", error);
    return NextResponse.json({ error: "Failed to list documents." }, { status: 500 });
  }
}
