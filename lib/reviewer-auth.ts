import { createHash, timingSafeEqual } from "crypto";
import { env } from "./env";

export const REVIEWER_COOKIE = "ayudita_reviewer_unlock";

export function isReviewerGateEnabled() {
  return Boolean(env.ayuditaReviewPassword);
}

export function isReviewerPasswordValid(password: string) {
  if (!env.ayuditaReviewPassword) return false;
  const expected = Buffer.from(hashReviewerPassword(env.ayuditaReviewPassword));
  const actual = Buffer.from(hashReviewerPassword(password));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function reviewerUnlockToken() {
  if (!env.ayuditaReviewPassword) return "";
  return hashReviewerPassword(env.ayuditaReviewPassword);
}

export function isReviewerUnlocked(request: Request) {
  if (!isReviewerGateEnabled()) return true;
  const token = cookieValue(request.headers.get("cookie") ?? "", REVIEWER_COOKIE);
  return token === reviewerUnlockToken();
}

function hashReviewerPassword(password: string) {
  return createHash("sha256").update(`ayudita-review:${password}`).digest("hex");
}

function cookieValue(cookieHeader: string, name: string) {
  return cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
}
