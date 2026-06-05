import { NextResponse } from "next/server";
import { isReviewerUnlocked } from "@/lib/reviewer-auth";
import { listTrustedAnswers } from "@/lib/trusted-answers";

export async function GET(request: Request) {
  try {
    return NextResponse.json({
      trusted_answers: await listTrustedAnswers({
        isUnlocked: isReviewerUnlocked(request)
      })
    });
  } catch (error) {
    console.error("Failed to list trusted answers.", error);
    return NextResponse.json({ error: "Failed to list trusted answers." }, { status: 500 });
  }
}
