import { existsSync, readFileSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { extractReceipt } from "./extract";
import {
  getCorrection,
  listCorrections,
  upsertCorrection,
} from "./corrections-db";
import { createHash } from "node:crypto";

const PORT = 3000;
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";

type Label = { doc_id: string; doc_hash: string };

const labels: Label[] = (await Bun.file("evals/labels.jsonl").text())
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

await mkdir("evals/raw", { recursive: true });

function cors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": WEB_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(), "Content-Type": "application/json" },
  });
}

// Extract (or read raw cache). Only reached when no correction exists.
async function getRawExtraction(label: Label): Promise<unknown> {
  const cachePath = `evals/raw/${label.doc_hash}.json`;
  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, "utf8"));
  }
  const png = Buffer.from(
    await Bun.file(`evals/docs/${label.doc_id}.png`).arrayBuffer(),
  );
  const extraction = await extractReceipt(png);
  await writeFile(cachePath, JSON.stringify(extraction, null, 2));
  return extraction;
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: cors() });
    }

    if (path === "/api/docs" && req.method === "GET") {
      return json(labels.map((l) => ({ doc_id: l.doc_id })));
    }

    if (path === "/api/corrections" && req.method === "GET") {
      return json(listCorrections());
    }

    // GET /api/health — mobile connectivity check
    if (path === "/api/health" && req.method === "GET") {
      return json({ ok: true, time: new Date().toISOString() });
    }

    // POST /api/extract — accepts any image, returns extraction.
    //
    // Cache layers tried in cheapest-first order:
    //
    //   L1 — exact byte hash (SHA-256)     [implemented here]
    //        Catches: literal re-uploads of identical files
    //        Misses:  any re-encoding (Telegram, WhatsApp, screenshots, re-photo)
    //        Cost:    ~0ms CPU
    //
    //   L2 — perceptual hash (pHash / dHash)   [highest-ROI production addition]
    //        Catches: same image after compression, resize, minor crop
    //        Misses:  large perspective or lighting changes
    //        Cost:    ~10ms CPU, no API call
    //        Recipe: dHash 8x8 grayscale → 64-bit hash → Hamming distance < 10 = hit
    //
    //   L3 — semantic embedding (CLIP-style)   [only at high volume]
    //        Catches: same receipt re-photographed from a different angle
    //        Misses:  visually similar but different receipts (threshold-dependent)
    //        Cost:    ~50-100ms + vector DB
    //
    // All three layers write the SAME correction store (data/corrections.db).
    // Adding a layer = adding an index on the same table, not a new architecture.
    //
    // WARN: never lower a threshold to force a hit. A false hit serves the wrong
    // extraction silently, which is worse than paying for a Gemini call — the user
    // won't know to correct it, so the error compounds.
    //
    // Production cost at 10k receipts/day (rough): L1 only ≈ $19/day,
    // L1+L2 ≈ $14/day. The pHash function is ~30 lines and pays for itself day one.
    if (path === "/api/extract" && req.method === "POST") {
      const body = (await req.json()) as { image_base64: string };
      if (!body.image_base64) {
        return json({ error: "image_base64 required" }, 400);
      }

      const buffer = Buffer.from(body.image_base64, "base64");
      const hash = createHash("sha256").update(buffer).digest("hex");

      const correction = getCorrection(hash);
      if (correction) {
        return json({
          doc_hash: hash,
          extraction: JSON.parse(correction.corrected_json),
          from_correction: true,
        });
      }

      const cachePath = `evals/raw/${hash}.json`;
      if (existsSync(cachePath)) {
        return json({
          doc_hash: hash,
          extraction: JSON.parse(readFileSync(cachePath, "utf8")),
          from_correction: false,
        });
      }

      const extraction = await extractReceipt(buffer);
      await writeFile(cachePath, JSON.stringify(extraction, null, 2));
      return json({
        doc_hash: hash,
        extraction,
        from_correction: false,
      });
    }

    const pngMatch = path.match(/^\/docs\/(r_\d+)\.png$/);
    if (pngMatch && req.method === "GET") {
      const filePath = `evals/docs/${pngMatch[1]}.png`;
      if (!existsSync(filePath)) {
        return new Response("Not found", { status: 404, headers: cors() });
      }
      return new Response(Bun.file(filePath), {
        headers: { ...cors(), "Content-Type": "image/png" },
      });
    }

    // GET /api/docs/:id — correction-first, then raw cache, then extract.
    const docMatch = path.match(/^\/api\/docs\/(r_\d+)$/);
    if (docMatch && req.method === "GET") {
      const label = labels.find((l) => l.doc_id === docMatch[1]);
      if (!label) {
        return new Response("Not found", { status: 404, headers: cors() });
      }

      const correction = getCorrection(label.doc_hash);
      if (correction) {
        return json({
          doc_id: label.doc_id,
          doc_hash: label.doc_hash,
          extraction: JSON.parse(correction.corrected_json),
          original_extraction: JSON.parse(correction.original_json),
          from_correction: true,
        });
      }

      const extraction = await getRawExtraction(label);
      return json({
        doc_id: label.doc_id,
        doc_hash: label.doc_hash,
        extraction,
        original_extraction: null,
        from_correction: false,
      });
    }

    // POST /api/docs/:id/corrections
    const corrMatch = path.match(/^\/api\/docs\/(r_\d+)\/corrections$/);
    if (corrMatch && req.method === "POST") {
      const label = labels.find((l) => l.doc_id === corrMatch[1]);
      if (!label) {
        return new Response("Not found", { status: 404, headers: cors() });
      }
      const body = (await req.json()) as {
        original: unknown;
        corrected: unknown;
        duration_ms: number;
      };
      upsertCorrection({
        doc_hash: label.doc_hash,
        doc_id: label.doc_id,
        original: body.original,
        corrected: body.corrected,
        duration_ms: body.duration_ms,
      });
      return json({ ok: true });
    }

    return new Response("Not found", { status: 404, headers: cors() });
  },
});

console.log(`server on http://localhost:${PORT}`);
console.log(`CORS allowed from ${WEB_ORIGIN}`);
