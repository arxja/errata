import { z } from "zod";

/**
 * Receipt extraction schema.
 *
 * Rules from the blueprint:
 *  1. Every scalar field is nullable. Required fields → hallucination.
 *  2. line_items is always an array (may be empty). We don't allow null here
 *     because a receipt structurally has zero or more items; "unknown" is
 *     better expressed as an empty array than null.
 *
 * No confidence siblings yet — those land in S3.
 */
export const Receipt = z.object({
  merchant: z
    .string()
    .nullable()
    .describe("Merchant or store name as printed at the top of the receipt"),
  date: z
    .string()
    .nullable()
    .describe("Transaction date normalized to YYYY-MM-DD, or null if unreadable"),
  total: z
    .number()
    .nullable()
    .describe("Final total the customer pays, as a number without currency symbols"),
  currency: z
    .enum(["USD", "EUR", "GBP", "other"])
    .nullable()
    .describe(
      "ISO-style currency. Use other for any currency not USD/EUR/GBP. Null if no currency is indicated"
    ),
  line_items: z
    .array(
      z.object({
        description: z.string().nullable(),
        amount: z.number().nullable(),
      })
    )
    .describe(
      "One entry per purchased item. Exclude subtotal, discount, tax, and total rows."
    ),
});

export type Receipt = z.infer<typeof Receipt>;