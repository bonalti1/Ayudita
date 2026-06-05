import OpenAI from "openai";
import { z } from "zod";
import { env } from "./env";

export const extractionSchema = z.object({
  title: z.string(),
  memoryType: z.enum(["document", "event", "relationship", "personal_fact", "life_history"]),
  category: z.string(),
  summary: z.string(),
  fields: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      type: z.string(),
      confidence: z.number().min(0).max(1)
    })
  ),
  reminders: z.array(
    z.object({
      title: z.string(),
      dueAt: z.string().nullable(),
      remindAt: z.string().nullable()
    })
  )
});

export type ExtractedMemory = z.infer<typeof extractionSchema>;

export function createOpenAIClient() {
  if (!env.openaiApiKey) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  return new OpenAI({ apiKey: env.openaiApiKey });
}

export async function extractMemoryFromText(input: string): Promise<ExtractedMemory> {
  const client = createOpenAIClient();

  const response = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content:
          "You extract structured personal memory from user-provided documents, notes, and WhatsApp messages. Return concise JSON only."
      },
      {
        role: "user",
        content: input
      }
    ],
    response_format: { type: "json_object" }
  });

  const content = response.choices[0]?.message.content;
  if (!content) {
    throw new Error("OpenAI returned an empty extraction response.");
  }

  return extractionSchema.parse(JSON.parse(content));
}
