import { z } from "zod";

const Conf = z
  .enum(["high", "low"])
  .describe(
    "Your confidence in this field. Use low whenever the value was inferred, partially visible, or ambiguous.",
  );

/**
 * Receipt extraction schema.
 *
 * Rules from the blueprint:
 *  1. Every scalar field is nullable. Required fields → hallucination.
 *  2. line_items is always an array (may be empty). We don't allow null here
 *     because a receipt structurally has zero or more items; "unknown" is
 *     better expressed as an empty array than null.
 *
 */
export const Receipt = z.object({
  merchant: z
    .string()
    .nullable()
    .describe("Merchant or store name as printed at the top of the receipt"),
  merchant_confidence: Conf,

  date: z
    .string()
    .nullable()
    .describe(
      "Transaction date normalized to YYYY-MM-DD, or null if unreadable",
    ),
  date_confidence: Conf,

  total: z
    .number()
    .nullable()
    .describe("Final total the customer pays, without currency symbols"),
  total_confidence: Conf,

  currency: z
    .enum(["USD", "EUR", "GBP", "other"])
    .nullable()
    .describe(
      "ISO-style currency. Use other for anything else. Null if no currency is indicated",
    ),
  currency_confidence: Conf,

  line_items: z
    .array(
      z.object({
        description: z.string().nullable(),
        amount: z.number().nullable(),
      }),
    )
    .describe(
      "One entry per purchased item. Exclude subtotal, discount, tax, and total rows.",
    ),
  line_items_confidence: Conf,
});

export type Receipt = z.infer<typeof Receipt>;
