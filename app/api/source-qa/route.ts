import { NextResponse } from "next/server";
import { isReviewerUnlocked } from "@/lib/reviewer-auth";
import { runSourceQaBatch } from "@/lib/source-qa";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await runSourceQaBatch({ isUnlocked: isReviewerUnlocked(request) }));
  } catch (error) {
    console.error("Failed to run source QA.", error);
    return NextResponse.json({ error: "Failed to run source QA." }, { status: 500 });
  }
}
