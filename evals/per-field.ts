// Per-field eval on the clean synthetic set.
// Usage:  bun evals/per-field.ts [--no-cache]
//
// Cache: evals/raw/<doc_hash>.json — keyed by sha256 of the PNG.
// Same doc → same hash → cached JSON. Delete the folder to force re-extraction.

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { extractReceipt } from "../src/extract";
import type { Receipt } from "../src/schema";

const NO_CACHE = process.argv.includes("--no-cache");
const RAW_DIR = "evals/raw";
const LABELS = "evals/labels.jsonl";
const DOCS = "evals/docs";

type Label = {
  doc_id: string;
  doc_hash: string;
  seed: number;
  fields: Receipt;
};

type Result = {
  label: Label;
  pred: Receipt;
  cached: boolean;
};

// --- matching helpers -------------------------------------------------------

function eqStr(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function eqNum(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= 0.01;
}

function eqEnum(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return true;
  return a === b;
}

// --- eval -------------------------------------------------------------------

type FieldResult = {
  field: string;
  correct: number;
  total: number;
  fails: string[]; // doc_ids
};

async function main() {
  await mkdir(RAW_DIR, { recursive: true });

  const labels: Label[] = readFileSync(LABELS, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

  const results: Result[] = [];

  console.log(`Extracting ${labels.length} receipts...\n`);

  for (const label of labels) {
    const cachePath = `${RAW_DIR}/${label.doc_hash}.json`;

    let pred: Receipt;
    let cached = false;

    if (!NO_CACHE && existsSync(cachePath)) {
      pred = JSON.parse(readFileSync(cachePath, "utf8"));
      cached = true;
    } else {
      const png = readFileSync(`${DOCS}/${label.doc_id}.png`);
      pred = await extractReceipt(png);
      await writeFile(cachePath, JSON.stringify(pred, null, 2));
    }

    process.stdout.write(
      `${label.doc_id} ${cached ? "(cached)" : "(fresh)"}  `,
    );
    results.push({ label, pred, cached });
  }
  console.log("\n");

  // Scalar metrics.
  const scalars = [
    {
      field: "merchant",
      cmp: (a: Label, b: Receipt) => eqStr(a.fields.merchant, b.merchant),
    },
    {
      field: "date",
      cmp: (a: Label, b: Receipt) => eqStr(a.fields.date, b.date),
    },
    {
      field: "total",
      cmp: (a: Label, b: Receipt) => eqNum(a.fields.total, b.total),
    },
    {
      field: "currency",
      cmp: (a: Label, b: Receipt) => eqEnum(a.fields.currency, b.currency),
    },
  ];

  const scalarResults: FieldResult[] = scalars.map(({ field, cmp }) => {
    let correct = 0;
    const fails: string[] = [];
    for (const r of results) {
      if (cmp(r.label, r.pred)) correct++;
      else fails.push(r.label.doc_id);
    }
    return { field, correct, total: results.length, fails };
  });

  // Line items — length, pairwise description, pairwise amount.
  let lengthCorrect = 0;
  const lengthFails: string[] = [];
  let descCorrect = 0,
    descTotal = 0,
    amtCorrect = 0,
    amtTotal = 0;
  let extras = 0,
    missings = 0;

  for (const r of results) {
    const L = r.label.fields.line_items;
    const P = r.pred.line_items;
    if (L.length === P.length) lengthCorrect++;
    else lengthFails.push(r.label.doc_id);

    const paired = Math.min(L.length, P.length);
    const slots = Math.max(L.length, P.length);
    descTotal += slots;
    amtTotal += slots;
    extras += Math.max(0, P.length - L.length);
    missings += Math.max(0, L.length - P.length);

    for (let i = 0; i < paired; i++) {
      if (eqStr(L[i].description, P[i].description)) descCorrect++;
      if (eqNum(L[i].amount, P[i].amount)) amtCorrect++;
    }
  }

  // --- print ----------------------------------------------------------------

  const pad = (s: string, n: number) => s.padEnd(n);

  // === Confidence calibration ===
  // For each field, bucket predictions by predicted confidence and report
  // accuracy in each bucket. Blueprint done-when: low-conf fields are wrong
  // >=60% of the time. On a 0-error set this is vacuous — recorded as such.
  const confFields: Array<{
    field: keyof Receipt;
    confKey: keyof Receipt;
    cmp: (a: Label, b: Receipt) => boolean;
  }> = [
    {
      field: "merchant",
      confKey: "merchant_confidence",
      cmp: (a, b) => eqStr(a.fields.merchant, b.merchant),
    },
    {
      field: "date",
      confKey: "date_confidence",
      cmp: (a, b) => eqStr(a.fields.date, b.date),
    },
    {
      field: "total",
      confKey: "total_confidence",
      cmp: (a, b) => eqNum(a.fields.total, b.total),
    },
    {
      field: "currency",
      confKey: "currency_confidence",
      cmp: (a, b) => eqEnum(a.fields.currency, b.currency),
    },
  ];

  console.log("\n=== Confidence calibration ===");
  console.log(
    pad("field", 12) +
      pad("conf", 6) +
      pad("count", 8) +
      pad("correct", 10) +
      "accuracy",
  );

  const lowStats = { count: 0, wrong: 0 };

  for (const { field, confKey, cmp } of confFields) {
    const buckets = new Map<string, { count: number; correct: number }>();
    for (const r of results) {
      const conf = String((r.pred as any)[confKey]);
      const ok = cmp(r.label, r.pred);
      const e = buckets.get(conf) ?? { count: 0, correct: 0 };
      e.count++;
      if (ok) e.correct++;
      buckets.set(conf, e);
      if (conf === "low") {
        lowStats.count++;
        if (!ok) lowStats.wrong++;
      }
    }
    for (const conf of ["high", "low"]) {
      const e = buckets.get(conf);
      if (!e) {
        console.log(
          pad(field, 12) + pad(conf, 6) + pad("0", 8) + pad("-", 10) + "n/a",
        );
        continue;
      }
      const acc = ((e.correct / e.count) * 100).toFixed(1) + "%";
      console.log(
        pad(field, 12) +
          pad(conf, 6) +
          pad(String(e.count), 8) +
          pad(String(e.correct), 10) +
          acc,
      );
    }
  }

  const lowWrongRate =
    lowStats.count === 0
      ? "n/a (no low-confidence fields)"
      : ((lowStats.wrong / lowStats.count) * 100).toFixed(1) + "%";
  console.log(
    `\nlow-confidence wrong rate: ${lowWrongRate}  (blueprint target: >=60%)`,
  );

  console.log("=== Scalar fields ===");
  console.log(
    pad("field", 12) + pad("correct", 10) + pad("total", 8) + "accuracy",
  );
  for (const r of scalarResults) {
    const acc = ((r.correct / r.total) * 100).toFixed(1) + "%";
    console.log(
      pad(r.field, 12) +
        pad(String(r.correct), 10) +
        pad(String(r.total), 8) +
        acc,
    );
  }

  console.log("\n=== Line items ===");
  console.log(
    pad("metric", 24) + pad("correct", 10) + pad("total", 8) + "accuracy",
  );
  console.log(
    pad("length match", 24) +
      pad(String(lengthCorrect), 10) +
      pad(String(results.length), 8) +
      ((lengthCorrect / results.length) * 100).toFixed(1) +
      "%",
  );
  console.log(
    pad("description (pair)", 24) +
      pad(String(descCorrect), 10) +
      pad(String(descTotal), 8) +
      ((descCorrect / descTotal) * 100).toFixed(1) +
      "%",
  );
  console.log(
    pad("amount (pair)", 24) +
      pad(String(amtCorrect), 10) +
      pad(String(amtTotal), 8) +
      ((amtCorrect / amtTotal) * 100).toFixed(1) +
      "%",
  );
  console.log(
    `\nextra items (hallucinated): ${extras}\nmissing items (skipped):     ${missings}`,
  );

  // Per-merchant breakdown.
  console.log("\n=== By merchant ===");
  console.log(
    pad("merchant", 22) + pad("docs", 6) + pad("failing", 10) + "scalar acc",
  );
  const byMerchant = new Map<string, { docs: number; fails: number }>();
  for (const r of results) {
    const m = r.label.fields.merchant ?? "(unknown)";
    const e = byMerchant.get(m) ?? { docs: 0, fails: 0 };
    e.docs++;
    const anyWrong =
      !eqStr(r.label.fields.merchant, r.pred.merchant) ||
      !eqStr(r.label.fields.date, r.pred.date) ||
      !eqNum(r.label.fields.total, r.pred.total) ||
      !eqEnum(r.label.fields.currency, r.pred.currency);
    if (anyWrong) e.fails++;
    byMerchant.set(m, e);
  }
  for (const [m, e] of byMerchant) {
    const acc = (((e.docs - e.fails) / e.docs) * 100).toFixed(1) + "%";
    console.log(
      pad(m, 22) + pad(String(e.docs), 6) + pad(String(e.fails), 10) + acc,
    );
  }

  // Per-doc failures.
  const failureLines: string[] = [];
  for (const r of results) {
    const fails: string[] = [];
    for (const s of scalarResults) {
      if (s.fails.includes(r.label.doc_id)) {
        const lv = (r.label.fields as any)[s.field];
        const pv = (r.pred as any)[s.field];
        fails.push(
          `  ${s.field}: label=${JSON.stringify(lv)} pred=${JSON.stringify(pv)}`,
        );
      }
    }
    if (r.label.fields.line_items.length !== r.pred.line_items.length) {
      fails.push(
        `  line_items.length: label=${r.label.fields.line_items.length} pred=${r.pred.line_items.length}`,
      );
    }
    if (fails.length > 0) {
      failureLines.push(
        `${r.label.doc_id} (${fails.length} error${fails.length > 1 ? "s" : ""})`,
      );
      failureLines.push(...fails);
    }
  }

  if (failureLines.length > 0) {
    console.log("\n=== Failures ===");
    console.log(failureLines.join("\n"));
  } else {
    console.log("\n=== No failures ===");
  }
}

main().catch((err) => {
  console.error("\nEVAL FAILED");
  console.error(err);
  process.exit(1);
});
