// Per-bucket eval across clean/photo/hard.
// Usage:  bun evals/per-field.ts [--no-cache]
//
// Doc discovery: scan evals/docs/, parse (base_id, bucket) from filename.
//   r_NNNN.png         → clean
//   r_NNNN_photo.jpg   → photo
//   r_NNNN_hard.jpg    → hard
// Labels: evals/labels.jsonl keyed by base_id (shared across buckets).
// Cache:  evals/raw/<doc_hash>.json keyed by content hash of the input bytes.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extractReceipt } from "../src/extract";
import type { Receipt } from "../src/schema";

const NO_CACHE = process.argv.includes("--no-cache");
const RAW_DIR = "evals/raw";
const LABELS = "evals/labels.jsonl";
const DOCS = "evals/docs";

type Bucket = "clean" | "photo" | "hard";
type Doc = { filename: string; base_id: string; bucket: Bucket };
type Label = { doc_id: string; doc_hash: string; seed: number; fields: Receipt };
type Result = { doc: Doc; label: Label; pred: Receipt; cached: boolean };

function listDocs(): Doc[] {
  const files = readdirSync(DOCS).filter((f) => /\.(png|jpg|jpeg)$/i.test(f));
  const out: Doc[] = [];
  for (const f of files) {
    const m = f.match(/^(r_\d+)(?:_(photo|hard))?\.(png|jpg|jpeg)$/i);
    if (!m) continue;
    out.push({
      filename: f,
      base_id: m[1],
      bucket: (m[2] as Bucket) ?? "clean",
    });
  }
  out.sort((a, b) => a.filename.localeCompare(b.filename));
  return out;
}

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

function pad(s: string, n: number): string {
  return s.padEnd(n);
}

function reportBucket(bucket: Bucket, results: Result[]) {
  const n = results.length;
  if (n === 0) {
    console.log(`\n=== ${bucket.toUpperCase()} (no docs) ===`);
    return;
  }

  console.log(`\n=== ${bucket.toUpperCase()} (${n} docs) ===`);

  // Scalar metrics.
  const scalars = [
    { field: "merchant", cmp: (a: Label, b: Receipt) => eqStr(a.fields.merchant, b.merchant) },
    { field: "date",     cmp: (a: Label, b: Receipt) => eqStr(a.fields.date, b.date) },
    { field: "total",    cmp: (a: Label, b: Receipt) => eqNum(a.fields.total, b.total) },
    { field: "currency", cmp: (a: Label, b: Receipt) => eqEnum(a.fields.currency, b.currency) },
  ];

  console.log(pad("field", 12) + pad("correct", 10) + pad("total", 8) + "accuracy");
  for (const { field, cmp } of scalars) {
    let correct = 0;
    for (const r of results) if (cmp(r.label, r.pred)) correct++;
    const acc = ((correct / n) * 100).toFixed(1) + "%";
    console.log(pad(field, 12) + pad(String(correct), 10) + pad(String(n), 8) + acc);
  }

  // Line items.
  let lenOk = 0;
  let descOk = 0, descTot = 0, amtOk = 0, amtTot = 0;
  let extras = 0, missings = 0;

  for (const r of results) {
    const L = r.label.fields.line_items;
    const P = r.pred.line_items;
    if (L.length === P.length) lenOk++;
    else { extras += Math.max(0, P.length - L.length); missings += Math.max(0, L.length - P.length); }

    const paired = Math.min(L.length, P.length);
    const slots = Math.max(L.length, P.length);
    descTot += slots; amtTot += slots;
    for (let i = 0; i < paired; i++) {
      if (eqStr(L[i].description, P[i].description)) descOk++;
      if (eqNum(L[i].amount, P[i].amount)) amtOk++;
    }
  }

  console.log(pad("length match", 24) + pad(String(lenOk), 10) + pad(String(n), 8) + ((lenOk / n) * 100).toFixed(1) + "%");
  console.log(pad("description (pair)", 24) + pad(String(descOk), 10) + pad(String(descTot), 8) + ((descOk / descTot) * 100).toFixed(1) + "%");
  console.log(pad("amount (pair)", 24) + pad(String(amtOk), 10) + pad(String(amtTot), 8) + ((amtOk / amtTot) * 100).toFixed(1) + "%");
  console.log(`extra: ${extras}  missing: ${missings}`);

  // Confidence calibration.
  const confFields = [
    { field: "merchant", confKey: "merchant_confidence" as const, cmp: (a: Label, b: Receipt) => eqStr(a.fields.merchant, b.merchant) },
    { field: "date",     confKey: "date_confidence" as const,     cmp: (a: Label, b: Receipt) => eqStr(a.fields.date, b.date) },
    { field: "total",    confKey: "total_confidence" as const,    cmp: (a: Label, b: Receipt) => eqNum(a.fields.total, b.total) },
    { field: "currency", confKey: "currency_confidence" as const, cmp: (a: Label, b: Receipt) => eqEnum(a.fields.currency, b.currency) },
  ];

  console.log("\n" + pad("conf field", 12) + pad("conf", 6) + pad("count", 8) + pad("correct", 10) + "accuracy");

  let lowCount = 0, lowWrong = 0;
  for (const { field, confKey, cmp } of confFields) {
    const buckets = new Map<string, { c: number; ok: number }>();
    for (const r of results) {
      const conf = String((r.pred as any)[confKey]);
      const ok = cmp(r.label, r.pred);
      const e = buckets.get(conf) ?? { c: 0, ok: 0 };
      e.c++; if (ok) e.ok++;
      buckets.set(conf, e);
      if (conf === "low") { lowCount++; if (!ok) lowWrong++; }
    }
    for (const conf of ["high", "low"]) {
      const e = buckets.get(conf);
      if (!e) { console.log(pad(field, 12) + pad(conf, 6) + pad("0", 8) + pad("-", 10) + "n/a"); continue; }
      console.log(pad(field, 12) + pad(conf, 6) + pad(String(e.c), 8) + pad(String(e.ok), 10) + ((e.ok / e.c) * 100).toFixed(1) + "%");
    }
  }

  const lowWrongRate = lowCount === 0 ? "n/a (no low)" : ((lowWrong / lowCount) * 100).toFixed(1) + "%";
  console.log(`low-confidence wrong rate: ${lowWrongRate}`);
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });

  const labels: Label[] = readFileSync(LABELS, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const labelById = new Map(labels.map((l) => [l.doc_id, l]));

  const docs = listDocs();
  if (docs.length === 0) {
    console.log(`No docs found in ${DOCS}/`);
    return;
  }

  console.log(`Extracting ${docs.length} docs across buckets...\n`);

  const allResults: Result[] = [];
  for (const doc of docs) {
    const label = labelById.get(doc.base_id);
    if (!label) {
      console.warn(`no label for ${doc.base_id}, skipping ${doc.filename}`);
      continue;
    }

    const bytes = readFileSync(`${DOCS}/${doc.filename}`);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const cachePath = `${RAW_DIR}/${hash}.json`;

    let pred: Receipt;
    let cached = false;
    if (!NO_CACHE && existsSync(cachePath)) {
      pred = JSON.parse(readFileSync(cachePath, "utf8"));
      cached = true;
    } else {
      pred = await extractReceipt(bytes);
      await writeFile(cachePath, JSON.stringify(pred, null, 2));
    }

    process.stdout.write(`${doc.filename} ${cached ? "·" : "*"}  `);
    allResults.push({ doc, label, pred, cached });
  }
  console.log("\n");

  const byBucket: Record<Bucket, Result[]> = { clean: [], photo: [], hard: [] };
  for (const r of allResults) byBucket[r.doc.bucket].push(r);

  for (const b of ["clean", "photo", "hard"] as Bucket[]) {
    reportBucket(b, byBucket[b]);
  }

  // Failures, grouped.
  console.log(`\n=== Failures ===`);
  const failsByBucket: Record<Bucket, string[]> = { clean: [], photo: [], hard: [] };
  for (const r of allResults) {
    const f: string[] = [];
    if (!eqStr(r.label.fields.merchant, r.pred.merchant)) f.push(`merchant: ${JSON.stringify(r.pred.merchant)} ≠ ${JSON.stringify(r.label.fields.merchant)}`);
    if (!eqStr(r.label.fields.date, r.pred.date)) f.push(`date: ${JSON.stringify(r.pred.date)} ≠ ${JSON.stringify(r.label.fields.date)}`);
    if (!eqNum(r.label.fields.total, r.pred.total)) f.push(`total: ${JSON.stringify(r.pred.total)} ≠ ${JSON.stringify(r.label.fields.total)}`);
    if (!eqEnum(r.label.fields.currency, r.pred.currency)) f.push(`currency: ${JSON.stringify(r.pred.currency)} ≠ ${JSON.stringify(r.label.fields.currency)}`);
    if (r.label.fields.line_items.length !== r.pred.line_items.length) f.push(`line_items.length: ${r.pred.line_items.length} ≠ ${r.label.fields.line_items.length}`);
    if (f.length > 0) failsByBucket[r.doc.bucket].push(`${r.doc.filename}:\n  ${f.join("\n  ")}`);
  }
  for (const b of ["clean", "photo", "hard"] as Bucket[]) {
    if (failsByBucket[b].length === 0) continue;
    console.log(`\n[${b}]`);
    for (const line of failsByBucket[b]) console.log(line);
  }
}

main().catch((e) => {
  console.error("\nEVAL FAILED");
  console.error(e);
  process.exit(1);
});