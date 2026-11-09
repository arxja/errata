// NOTE: synthetic receipts are clean by construction. They measure pipeline
// correctness, not real-world tail accuracy. Real `hard` bucket arrives in S8.

import { mkdir, writeFile } from "node:fs/promises";
import { buildPlan, generateReceipt } from "./data";
import { renderReceipt } from "./render";
import { labelFrom } from "./label";

const OUT_DIR = "evals/docs";
const LABELS_PATH = "evals/labels.jsonl";

await mkdir(OUT_DIR, { recursive: true });

const plan = buildPlan();
const lines: string[] = [];

for (let i = 0; i < plan.length; i++) {
  const docId = `r_${String(i + 1).padStart(4, "0")}`;
  const seed = 1000 + i;
  const { data, render } = generateReceipt(seed, plan[i]);
  const png = renderReceipt(data, render);
  const label = labelFrom(docId, seed, data, png);

  await writeFile(`${OUT_DIR}/${docId}.png`, png);
  lines.push(JSON.stringify(label));
}

await writeFile(LABELS_PATH, lines.join("\n") + "\n");

console.log(`wrote ${lines.length} receipts to ${OUT_DIR}/`);
console.log(`wrote ${lines.length} labels to ${LABELS_PATH}`);
console.log("\nvariance:");
console.log(`  merchants:          ${new Set(plan.map((p) => p.merchantId)).size}`);
console.log(`  null dates:         ${plan.filter((p) => p.nullDate).length}`);
console.log(`  null currencies:    ${plan.filter((p) => p.nullCurrency).length}`);
console.log(`  discount lines:     ${plan.filter((p) => p.discount).length}`);
console.log(`  null item amounts:  ${plan.filter((p) => p.nullAmountIndex !== undefined).length}`);