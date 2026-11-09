import { readFileSync } from "node:fs";
import { z } from "zod";
import { ai, GEMINI_MODEL, zodToGeminiSchema } from "./lib/gemini";

const Receipt = z.object({
  merchant: z.string().describe("Merchant or store name"),
  date: z.string().describe("Date in YYYY-MM-DD format if possible"),
  total: z.number().describe("Final total amount"),
  currency: z.enum(["USD", "EUR", "GBP", "other"]).describe("Currency code"),
  line_items: z
    .array(
      z.object({
        description: z.string(),
        amount: z.number(),
      }),
    )
    .describe("Purchased items"),
});

const schema = zodToGeminiSchema(Receipt);

const prompt = `
Extract receipt data from the input.
Return only JSON that matches the schema.
If a value is not visible, use your best guess.
`;

function buildContents(imagePath?: string) {
  if (!imagePath) {
    return [
      { text: prompt },
      {
        text: [
          "Receipt text:",
          "Blue Bottle Coffee",
          "2026-10-14",
          "Latte 5.50",
          "Croissant 4.25",
          "Total 9.75 USD",
        ].join("\n"),
      },
    ];
  }

  const data = readFileSync(imagePath).toString("base64");
  const mimeType = imagePath.toLowerCase().endsWith(".pdf")
    ? "application/pdf"
    : "image/png";

  return [{ text: prompt }, { inlineData: { mimeType, data } }];
}

async function main() {
  const imagePath = process.argv[2];

  console.log("model:", GEMINI_MODEL);
  console.log("schema:", JSON.stringify(schema, null, 2));

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: buildContents(imagePath),
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: schema,
      temperature: 0,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned no text");
  }

  console.log("\nraw:\n" + text);

  const parsed = Receipt.parse(JSON.parse(text));
  console.log("\nvalidated:\n" + JSON.stringify(parsed, null, 2));
}

main().catch((error) => {
  console.error("\nSMOKE FAILED");
  console.error(error);
  process.exit(1);
});
