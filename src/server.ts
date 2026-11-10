import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { extractReceipt } from "./extract";

const PORT = 3000;
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";

type Label = { doc_id: string; doc_hash: string };
type Receipt = ReturnType<typeof JSON.parse>;

const labels: Label[] = (await Bun.file("evals/labels.jsonl").text())
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

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

async function getExtraction(label: Label): Promise<unknown> {
  const cachePath = `evals/raw/${label.doc_hash}.json`;
  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, "utf8"));
  }
  const png = Buffer.from(
    await Bun.file(`evals/docs/${label.doc_id}.png`).arrayBuffer()
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

    // GET /api/docs — list
    if (path === "/api/docs" && req.method === "GET") {
      return json(labels.map((l) => ({ doc_id: l.doc_id })));
    }

    // GET /docs/:id.png — receipt image
    const pngMatch = path.match(/^\/docs\/(r_\d+)\.png$/);
    if (pngMatch && req.method === "GET") {
      const filePath = `evals/docs/${pngMatch[1]}.png`;
      if (!existsSync(filePath)) return new Response("Not found", { status: 404, headers: cors() });
      return new Response(Bun.file(filePath), {
        headers: { ...cors(), "Content-Type": "image/png" },
      });
    }

    // GET /api/docs/:id — extraction
    const docMatch = path.match(/^\/api\/docs\/(r_\d+)$/);
    if (docMatch && req.method === "GET") {
      const label = labels.find((l) => l.doc_id === docMatch[1]);
      if (!label) return new Response("Not found", { status: 404, headers: cors() });
      const extraction = await getExtraction(label);
      return json({ doc_id: label.doc_id, doc_hash: label.doc_hash, extraction });
    }

    // POST /api/docs/:id/corrections
    const corrMatch = path.match(/^\/api\/docs\/(r_\d+)\/corrections$/);
    if (corrMatch && req.method === "POST") {
      const label = labels.find((l) => l.doc_id === corrMatch[1]);
      if (!label) return new Response("Not found", { status: 404, headers: cors() });
      const body = (await req.json()) as {
        original: unknown;
        corrected: unknown;
        duration_ms: number;
      };
      await mkdir("data/corrections", { recursive: true });
      await writeFile(
        `data/corrections/${label.doc_hash}.json`,
        JSON.stringify(
          {
            doc_id: label.doc_id,
            doc_hash: label.doc_hash,
            saved_at: new Date().toISOString(),
            duration_ms: body.duration_ms,
            original: body.original,
            corrected: body.corrected,
          },
          null,
          2
        )
      );
      return json({ ok: true });
    }

    return new Response("Not found", { status: 404, headers: cors() });
  },
});

console.log(`server on http://localhost:${PORT}`);
console.log(`CORS allowed from ${WEB_ORIGIN}`);