import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { memoryItems, type MemoryItem } from "./memory-data";

const dataDir = path.join(process.cwd(), "data");
const dataFile = path.join(dataDir, "memories.json");

async function ensureStore() {
  await mkdir(dataDir, { recursive: true });

  try {
    await readFile(dataFile, "utf8");
  } catch {
    await writeFile(dataFile, JSON.stringify(memoryItems, null, 2));
  }
}

export async function listMemories(): Promise<MemoryItem[]> {
  await ensureStore();
  const raw = await readFile(dataFile, "utf8");
  return JSON.parse(raw) as MemoryItem[];
}

export async function createMemory(input: {
  title?: string;
  body: string;
  source?: "web" | "whatsapp";
}): Promise<MemoryItem> {
  const memories = await listMemories();
  const now = new Date();
  const title = input.title?.trim() || inferTitle(input.body);
  const sourceLabel = input.source === "whatsapp" ? "WhatsApp" : "Web";

  const memory: MemoryItem = {
    id: `memory-${now.getTime()}`,
    title,
    meta: `${sourceLabel} · texto · nuevo`,
    type: "review",
    icon: inferIcon(input.body),
    tone: "red",
    status: "Revisar",
    summary: `Ayudita guardó esta memoria y la dejó lista para confirmar: ${input.body.trim()}`,
    fields: [
      ["Origen", sourceLabel],
      ["Tipo", "Texto"],
      ["Creado", now.toLocaleDateString("es-US")],
      ["Estado", "Necesita revisión"]
    ]
  };

  const updated = [memory, ...memories];
  await writeFile(dataFile, JSON.stringify(updated, null, 2));
  return memory;
}

function inferTitle(body: string) {
  const clean = body.trim().replace(/\s+/g, " ");
  if (!clean) return "Nueva memoria";
  if (/cumple|birthday/i.test(clean)) return "Cumpleaños guardado";
  if (/seguro|insurance/i.test(clean)) return "Nota de seguro";
  if (/doctor|m[eé]dic|laboratorio|lab/i.test(clean)) return "Nota de salud";
  return clean.length > 48 ? `${clean.slice(0, 48)}...` : clean;
}

function inferIcon(body: string): MemoryItem["icon"] {
  if (/cumple|birthday|mam[aá]|pap[aá]|hijo|hija|famil/i.test(body)) return "person";
  if (/doctor|m[eé]dic|laboratorio|lab|salud/i.test(body)) return "health";
  if (/bill|cuenta|vence|pagar/i.test(body)) return "bill";
  return "doc";
}
