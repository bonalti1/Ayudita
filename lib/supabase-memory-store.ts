import { createSupabaseServiceClient } from "./supabase";
import type { MemoryItem } from "./memory-data";

type MemoryItemRow = {
  id: string;
  source_type: string;
  memory_type: string;
  title: string;
  summary: string | null;
  status: string;
  created_at: string;
};

type ExtractedFieldRow = {
  memory_item_id: string;
  field_name: string;
  field_value: string;
};

const demoUserId = "00000000-0000-0000-0000-000000000001";

export async function listSupabaseMemories(): Promise<MemoryItem[]> {
  const supabase = createSupabaseServiceClient();

  const { data: memories, error } = await supabase
    .from("memory_items")
    .select("id, source_type, memory_type, title, summary, status, created_at")
    .order("created_at", { ascending: false });

  if (error) throw error;

  const ids = (memories ?? []).map((memory) => memory.id);
  const { data: fields, error: fieldsError } = ids.length
    ? await supabase
        .from("extracted_fields")
        .select("memory_item_id, field_name, field_value")
        .in("memory_item_id", ids)
    : { data: [], error: null };

  if (fieldsError) throw fieldsError;

  return (memories ?? []).map((memory) =>
    toMemoryItem(memory as MemoryItemRow, (fields ?? []) as ExtractedFieldRow[])
  );
}

export async function createSupabaseMemory(input: {
  title?: string;
  body: string;
  source?: "web" | "whatsapp";
}): Promise<MemoryItem> {
  const supabase = createSupabaseServiceClient();
  const title = input.title?.trim() || inferTitle(input.body);
  const sourceType = input.source === "whatsapp" ? "whatsapp" : "manual_note";

  await supabase.from("profiles").upsert({
    id: demoUserId,
    full_name: "Ayudita Demo",
    timezone: "America/Chicago",
    locale: "es"
  });

  const { data: memory, error } = await supabase
    .from("memory_items")
    .insert({
      user_id: demoUserId,
      source_type: sourceType,
      memory_type: "personal_fact",
      title,
      summary: `Ayudita guardó esta memoria y la dejó lista para confirmar: ${input.body.trim()}`,
      raw_text: input.body,
      status: "needs_review",
      confidence: 0.7
    })
    .select("id, source_type, memory_type, title, summary, status, created_at")
    .single();

  if (error) throw error;

  const fieldRows = [
    { field_name: "Origen", field_value: input.source === "whatsapp" ? "WhatsApp" : "Web" },
    { field_name: "Tipo", field_value: "Texto" },
    { field_name: "Estado", field_value: "Necesita revisión" }
  ].map((field) => ({
    user_id: demoUserId,
    memory_item_id: memory.id,
    field_name: field.field_name,
    field_value: field.field_value,
    field_type: "text",
    confidence: 1,
    review_status: "auto"
  }));

  const { error: fieldError } = await supabase.from("extracted_fields").insert(fieldRows);
  if (fieldError) throw fieldError;

  return toMemoryItem(memory as MemoryItemRow, fieldRows);
}

function toMemoryItem(memory: MemoryItemRow, fields: ExtractedFieldRow[]): MemoryItem {
  const itemFields = fields
    .filter((field) => field.memory_item_id === memory.id)
    .map((field) => [field.field_name, field.field_value] as [string, string]);

  return {
    id: memory.id,
    title: memory.title,
    meta: `${sourceLabel(memory.source_type)} · texto · Supabase`,
    type: memory.status === "ready" ? "ready" : "review",
    icon: inferIcon(memory.title),
    tone: memory.status === "ready" ? "green" : "red",
    status: memory.status === "ready" ? "Listo" : "Revisar",
    summary: memory.summary ?? "Memoria guardada en Supabase.",
    fields: itemFields.length ? itemFields : [["Origen", sourceLabel(memory.source_type)]]
  };
}

function sourceLabel(source: string) {
  if (source === "whatsapp") return "WhatsApp";
  if (source === "web_upload") return "Web";
  return "Web";
}

function inferTitle(body: string) {
  const clean = body.trim().replace(/\s+/g, " ");
  if (!clean) return "Nueva memoria";
  if (/cumple|birthday/i.test(clean)) return "Cumpleaños guardado";
  if (/seguro|insurance/i.test(clean)) return "Nota de seguro";
  if (/doctor|m[eé]dic|laboratorio|lab/i.test(clean)) return "Nota de salud";
  return clean.length > 48 ? `${clean.slice(0, 48)}...` : clean;
}

function inferIcon(text: string): MemoryItem["icon"] {
  if (/cumple|birthday|mam[aá]|pap[aá]|hijo|hija|famil/i.test(text)) return "person";
  if (/doctor|m[eé]dic|laboratorio|lab|salud/i.test(text)) return "health";
  if (/bill|cuenta|vence|pagar/i.test(text)) return "bill";
  return "doc";
}
