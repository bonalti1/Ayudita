import { NextResponse } from "next/server";
import { querySavedMemory } from "@/lib/memory-query";
import { isReviewerUnlocked } from "@/lib/reviewer-auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { question?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";

  if (!question) {
    return NextResponse.json({ error: "Missing question." }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await querySavedMemory({
        question,
        isUnlocked: isReviewerUnlocked(request)
      })
    );
  } catch (error) {
    console.error("Failed to query memory.", error);
    return NextResponse.json({ error: "Failed to query memory." }, { status: 500 });
  }
}
