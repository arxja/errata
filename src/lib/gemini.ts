import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

export const GEMINI_MODEL =
  process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is missing. Add it to .env");
}

export const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/**
 * Gemini's responseJsonSchema is JSON Schema, but it rejects or ignores
 * some keys that Zod emits. Strip only what Gemini is known to reject.
 * Keep this list small and evidence-driven.
 */
export function sanitizeForGemini(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(sanitizeForGemini);
  }

  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(
      schema as Record<string, unknown>
    )) {
      if (["$schema", "additionalProperties", "default"].includes(key)) {
        continue;
      }
      out[key] = sanitizeForGemini(value);
    }

    return out;
  }

  return schema;
}

export function zodToGeminiSchema<T extends z.ZodType>(schema: T) {
  const jsonSchema = z.toJSONSchema(schema, {
    target: "draft-7",
    io: "output",
  });

  return sanitizeForGemini(jsonSchema);
}