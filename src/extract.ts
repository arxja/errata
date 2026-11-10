import { ai, GEMINI_MODEL, zodToGeminiSchema } from "./lib/gemini";
import { Receipt } from "./schema";

const PROMPT = `You extract structured data from receipt images.

Rules:
- Return every field defined in the schema. If a field is not visible or unclear, set it to null. Never guess.
- Date: normalize to YYYY-MM-DD. If no full date is visible, use null.
- Currency: USD, EUR, or GBP if clearly indicated. Use "other" for any other explicit currency. Null if no currency is indicated.
- Total: the final amount the customer pays. Null if unreadable.
- line_items: one entry per purchased item. Exclude subtotal, discount, tax, and total rows. If unreadable, return an empty array.
- Amounts are numbers, not strings. No currency symbols in numbers.
`;

const RESPONSE_SCHEMA = zodToGeminiSchema(Receipt);

export async function extractReceipt(pngBuffer: Buffer): Promise<Receipt> {
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      { text: PROMPT },
      {
        inlineData: {
          mimeType: "image/png",
          data: pngBuffer.toString("base64"),
        },
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: RESPONSE_SCHEMA,
      temperature: 0,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Gemini returned no text");

  return Receipt.parse(JSON.parse(text));
}
