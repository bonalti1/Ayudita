import { NextResponse } from "next/server";
import {
  disableDocumentMemory,
  getDecoderDocument,
  rememberDocumentAlias,
  rememberTrustedAnswerPrimary
} from "@/lib/decoder-store";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type MemoryActionBody =
  | { action: "rename"; alias?: string }
  | { action: "disable"; reason?: string }
  | { action: "set_primary"; trustedAnswerId?: string };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const document = await getDecoderDocument(id);

    if (!document) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    const body = (await request.json()) as MemoryActionBody;

    if (body.action === "rename") {
      const alias = body.alias?.trim();
      if (!alias) return NextResponse.json({ error: "A name is required." }, { status: 400 });

      await rememberDocumentAlias({
        documentId: document.id,
        userPhone: document.user_phone,
        alias
      });
    } else if (body.action === "disable") {
      await disableDocumentMemory({
        documentId: document.id,
        userPhone: document.user_phone,
        reason: body.reason ?? "disabled_from_dashboard"
      });
    } else if (body.action === "set_primary") {
      if (!body.trustedAnswerId) {
        return NextResponse.json({ error: "A trusted answer id is required." }, { status: 400 });
      }

      await rememberTrustedAnswerPrimary({
        documentId: document.id,
        userPhone: document.user_phone,
        trustedAnswerId: body.trustedAnswerId
      });
    } else {
      return NextResponse.json({ error: "Unsupported memory action." }, { status: 400 });
    }

    return NextResponse.json({ document: await getDecoderDocument(id) });
  } catch (error) {
    console.error("Failed to update document memory.", error);
    return NextResponse.json({ error: "Failed to update memory." }, { status: 500 });
  }
}
