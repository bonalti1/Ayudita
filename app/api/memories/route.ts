import { NextResponse } from "next/server";
import { createMemory, listMemories } from "@/lib/memory-store";
import { createSupabaseMemory, listSupabaseMemories } from "@/lib/supabase-memory-store";
import { env } from "@/lib/env";

function canUseSupabase() {
  return Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
}

export async function GET() {
  const memories = canUseSupabase() ? await listMemoriesWithFallback() : await listMemories();
  return NextResponse.json({ memories });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.body || typeof body.body !== "string") {
    return NextResponse.json({ error: "Missing memory body." }, { status: 400 });
  }

  const input = {
    title: typeof body.title === "string" ? body.title : undefined,
    body: body.body,
    source: body.source === "whatsapp" ? "whatsapp" : "web"
  } as const;

  const memory = canUseSupabase() ? await createMemoryWithFallback(input) : await createMemory(input);

  return NextResponse.json({ status: "created", memory }, { status: 201 });
}

async function listMemoriesWithFallback() {
  try {
    return await listSupabaseMemories();
  } catch (error) {
    console.warn("Supabase memory list failed; using local dev store.", error);
    return listMemories();
  }
}

async function createMemoryWithFallback(input: {
  title?: string;
  body: string;
  source: "web" | "whatsapp";
}) {
  try {
    return await createSupabaseMemory(input);
  } catch (error) {
    console.warn("Supabase memory create failed; using local dev store.", error);
    return createMemory(input);
  }
}
