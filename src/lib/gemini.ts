import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

export const GEMINI_MODEL =
  process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is missing. Add it to .env");
}

export const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/**
 * Strip keys Gemini's responseJsonSchema rejects or ignores.
 * Evidence-driven; extend only when a real failure demands it.
 */
export function sanitizeForGemini(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeForGemini);

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

/**
 * Convert Zod-style nullables to Gemini/OpenAPI-3.0 `nullable: true`.
 * Handles both `type: [X, "null"]` and `anyOf: [X, { type: "null" }]`.
 */
export function normalizeNullable(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(normalizeNullable);
  if (!schema || typeof schema !== "object") return schema;

  const s = schema as Record<string, unknown>;

  // type: ["string", "null"] → { type: "string", nullable: true }
  if (Array.isArray(s.type) && s.type.includes("null")) {
    const nonNull = (s.type as string[]).filter((t) => t !== "null");
    if (nonNull.length === 1) {
      return { ...s, type: nonNull[0], nullable: true };
    }
  }

  // anyOf: [X, { type: "null" }] → { ...X, nullable: true }
  if (Array.isArray(s.anyOf) && s.anyOf.length === 2) {
    const arr = s.anyOf as Array<Record<string, unknown>>;
    const nullIdx = arr.findIndex((b) => b?.type === "null");
    if (nullIdx !== -1) {
      const other = arr[1 - nullIdx];
      const merged: Record<string, unknown> = { ...other, nullable: true };
      if (s.description) merged.description = s.description;
      return normalizeNullable(merged);
    }
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) out[k] = normalizeNullable(v);
  return out;
}

export function zodToGeminiSchema<T extends z.ZodType>(schema: T) {
  const json = z.toJSONSchema(schema, { target: "draft-7", io: "output" });
  return normalizeNullable(sanitizeForGemini(json));
}