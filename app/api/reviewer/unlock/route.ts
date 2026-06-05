import { NextResponse } from "next/server";
import {
  isReviewerGateEnabled,
  isReviewerPasswordValid,
  REVIEWER_COOKIE,
  reviewerUnlockToken
} from "@/lib/reviewer-auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { password?: string } | null;

  if (!isReviewerGateEnabled()) {
    return NextResponse.json(
      { error: "Reviewer password is not configured." },
      { status: 503 }
    );
  }

  if (!body?.password || !isReviewerPasswordValid(body.password)) {
    return NextResponse.json({ error: "Invalid reviewer password." }, { status: 401 });
  }

  const response = NextResponse.json({ unlocked: true });
  response.cookies.set(REVIEWER_COOKIE, reviewerUnlockToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 8,
    path: "/"
  });

  return response;
}
