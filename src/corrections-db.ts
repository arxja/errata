import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";

const DB_PATH = "data/corrections.db";
const LEGACY_JSON_DIR = "data/corrections";
const MIGRATED_DIR = "data/corrections/.migrated";

export type CorrectionRow = {
  doc_hash: string;
  doc_id: string;
  original_json: string;
  corrected_json: string;
  duration_ms: number;
  created_at: string;
  updated_at: string;
};

mkdirSync("data", { recursive: true });

export const db = new Database(DB_PATH, { create: true });

db.exec(`
  CREATE TABLE IF NOT EXISTS corrections (
    doc_hash TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    original_json TEXT NOT NULL,
    corrected_json TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// One-shot migration of legacy `data/corrections/*.json` from S4.
// Idempotent: INSERT OR IGNORE means re-runs are no-ops.
// Moves source files into .migrated/ so they don't clutter the working dir.
function migrateLegacyJson(): void {
  if (!existsSync(LEGACY_JSON_DIR)) return;

  const glob = new Bun.Glob("*.json");
  const entries = Array.from(glob.scanSync({ cwd: LEGACY_JSON_DIR }));
  if (entries.length === 0) return;

  mkdirSync(MIGRATED_DIR, { recursive: true });

  const insert = db.prepare(
    `INSERT OR IGNORE INTO corrections
       (doc_hash, doc_id, original_json, corrected_json, duration_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  let migrated = 0;
  let skipped = 0;

  for (const name of entries) {
    const src = `${LEGACY_JSON_DIR}/${name}`;
    try {
      const parsed = JSON.parse(readFileSync(src, "utf8")) as {
        doc_id: string;
        doc_hash: string;
        saved_at: string;
        duration_ms: number;
        original: unknown;
        corrected: unknown;
      };
      insert.run(
        parsed.doc_hash,
        parsed.doc_id,
        JSON.stringify(parsed.original),
        JSON.stringify(parsed.corrected),
        parsed.duration_ms,
        parsed.saved_at,
        parsed.saved_at,
      );
      renameSync(src, `${MIGRATED_DIR}/${name}`);
      migrated++;
    } catch (err) {
      console.warn(`skip ${name}: ${(err as Error).message}`);
      skipped++;
    }
  }

  console.log(
    `migrated ${migrated} legacy correction(s) into SQLite` +
      (skipped > 0 ? ` (${skipped} skipped)` : ""),
  );
}

migrateLegacyJson();

export function getCorrection(doc_hash: string): CorrectionRow | null {
  const row = db
    .prepare("SELECT * FROM corrections WHERE doc_hash = ?")
    .get(doc_hash) as CorrectionRow | null;
  return row ?? null;
}

export function upsertCorrection(input: {
  doc_hash: string;
  doc_id: string;
  original: unknown;
  corrected: unknown;
  duration_ms: number;
}): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO corrections
       (doc_hash, doc_id, original_json, corrected_json, duration_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(doc_hash) DO UPDATE SET
       corrected_json = excluded.corrected_json,
       duration_ms    = excluded.duration_ms,
       updated_at     = excluded.updated_at`,
  ).run(
    input.doc_hash,
    input.doc_id,
    JSON.stringify(input.original),
    JSON.stringify(input.corrected),
    input.duration_ms,
    now,
    now,
  );
}

export function listCorrections() {
  return db
    .prepare(
      `SELECT doc_id, doc_hash, duration_ms, created_at, updated_at
       FROM corrections ORDER BY updated_at DESC`,
    )
    .all();
}
