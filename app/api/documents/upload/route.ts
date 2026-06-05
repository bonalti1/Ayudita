import { NextResponse } from "next/server";
import { createRawDecoderDocument } from "@/lib/decoder-store";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const userPhone = formData.get("userPhone");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file." }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Unsupported file type. Upload a JPG, PNG, WebP, or PDF." },
        { status: 400 }
      );
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "File is too large. Max size is 20 MB." }, { status: 400 });
    }

    const document = await createRawDecoderDocument({
      bytes: await file.arrayBuffer(),
      fileName: file.name,
      mimeType: file.type,
      userPhone: typeof userPhone === "string" ? userPhone : undefined,
      source: "web"
    });

    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    console.error("Failed to upload raw decoder document.", error);
    return NextResponse.json({ error: "Failed to upload document." }, { status: 500 });
  }
}
