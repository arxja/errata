import { createHash } from "node:crypto";
import type { ReceiptData } from "./data";

export type LabelEntry = {
  doc_id: string;
  doc_hash: string;
  seed: number;
  fields: ReceiptData;
};

export function labelFrom(
  docId: string,
  seed: number,
  data: ReceiptData,
  png: Buffer,
): LabelEntry {
  return {
    doc_id: docId,
    doc_hash: createHash("sha256").update(png).digest("hex"),
    seed,
    fields: data,
  };
}
