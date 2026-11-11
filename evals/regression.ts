// Regression test over corrections.db.
//
// Two questions per correction:
//   1. Does the running server serve the corrected JSON?  → GATE
//   2. Does the raw model (correction bypassed) match?     → DEBT (informational)
//
// Requires the server to be running on localhost:3000.

import { readFileSync } from "node:fs";
import { listCorrections, getCorrection } from "../src/corrections-db";
import { extractReceipt } from "../src/extract";

const SERVER = process.env.SERVER_URL ?? "http://localhost:3000";

type Row = { doc_id: string; doc_hash: string };

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v as object).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify((v as any)[k]))
      .join(",") +
    "}"
  );
}

function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

async function main() {
  // Server reachability — fail fast with a clear message.
  try {
    const r = await fetch(`${SERVER}/api/health`);
    if (!r.ok) throw new Error(`health returned ${r.status}`);
  } catch {
    console.error(
      `Server not reachable at ${SERVER}. Start it with: pnpm server`,
    );
    process.exit(1);
  }

  const rows = listCorrections() as Row[];

  if (rows.length === 0) {
    console.log(
      "No corrections yet. Correct a doc via the web UI, then re-run.",
    );
    return;
  }

  // Local labels map — for model-debt check we need the original bytes.
  const labels = (await Bun.file("evals/labels.jsonl").text())
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { doc_id: string });
  const labelIds = new Set(labels.map((l) => l.doc_id));

  let served = 0;
  let debt = 0;
  const failures: string[] = [];
  const debts: string[] = [];
  const skipped: string[] = [];

  for (const { doc_id, doc_hash } of rows) {
    const row = getCorrection(doc_hash)!;
    const expected = JSON.parse(row.corrected_json);

    if (!labelIds.has(doc_id)) {
      skipped.push(doc_id);
      continue;
    }

    // Gate: served extraction must equal the corrected JSON.
    const res = await fetch(`${SERVER}/api/docs/${doc_id}`);
    if (!res.ok) {
      failures.push(`${doc_id}: HTTP ${res.status}`);
      continue;
    }
    const body = (await res.json()) as {
      from_correction: boolean;
      extraction: unknown;
    };

    if (!body.from_correction) {
      failures.push(`${doc_id}: served, but not from correction`);
    } else if (!deepEqual(body.extraction, expected)) {
      failures.push(`${doc_id}: served !== corrected`);
    } else {
      served++;
    }

    // Debt: raw model — informational, not a failure.
    const png = readFileSync(`evals/docs/${doc_id}.png`);
    const raw = await extractReceipt(png);
    if (!deepEqual(raw, expected)) {
      debt++;
      debts.push(doc_id);
    }
  }

  // --- report ---
  const total = rows.length - skipped.length;

  console.log(`\n=== Corrections regression ===`);
  console.log(`total corrections:   ${rows.length}`);
  console.log(
    `checked:             ${total}  (${skipped.length} skipped: no local image)`,
  );
  console.log(`served correctly:    ${served}/${total}`);
  console.log(
    `raw-model debt:      ${debt}/${total}  (raw model still differs from corrected)`,
  );

  if (skipped.length > 0) {
    console.log(`\nskipped: ${skipped.join(", ")}`);
  }

  if (debts.length > 0) {
    console.log(`\nmodel debt (raw model still wrong on):`);
    for (const id of debts) console.log(`  ${id}`);
  }

  if (failures.length > 0) {
    console.log(`\n=== FAILURES ===`);
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
  } else {
    console.log(`\n=== PASS ===`);
  }
}

main().catch((e) => {
  console.error("\nREGRESSION FAILED");
  console.error(e);
  process.exit(1);
});
