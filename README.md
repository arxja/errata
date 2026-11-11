# Errata

Vision+text extraction system for receipts. Upload a PDF or image, get validated
JSON back with per-field confidence. A human fixes mistakes in a web UI. Every
correction is cached, becomes a regression test, and feeds future model work.

The model is a pure function. **The system around it is what learns.**

## Why this exists

Most extraction demos stop at "95% accurate." They never show the 60% tail on the
documents that matter — crumpled receipts, blurred photos, fields under fingerprints.
And a demo with 95% accuracy still costs money and produces mistakes 1 in 20 times,
with no mechanism for the user to fix what the model got wrong.

This project implements the full loop:

1. **Schema-constrained extraction** — Zod schema → Gemini structured output → validated JSON.
2. **Per-field confidence** — every scalar field carries a `high | low` self-assessment.
3. **Correction UI** — a human sees the receipt and the extraction side by side; fixes are captured with a measured time-to-correct.
4. **Content-addressed cache** — corrections are keyed by `sha256(image bytes)`; identical bytes short-circuit the model.
5. **Regression loop** — `bun evals` runs the clean set AND the corrections gate.

The design thesis: **an 85% model with a 5-second correction UI beats a 95% model
without one.** Measured on this project: `r_0018`, a doc the model gets wrong
confidently, was corrected in **5 seconds** end-to-end.

## Architecture

```text
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌─────────────────┐
│  Client  │────▶│  Server  │────▶│  Gemini  │     │ corrections.db  │
│ web/mob  │     │  Bun/TS  │     │  vision  │     │  SQLite         │
└──────────┘     └────┬─────┘     └──────────┘     └────────┬────────┘
                      │                                     │
                      │  1. hash = sha256(bytes)            │
                      │  2. lookup corrections[hash] ───────┘
                      │  3. hit?  → return corrected JSON
                      │  4. miss? → lookup raw cache
                      │  5. miss? → call Gemini
                      │  6. write raw cache
                      ▼
                 validated JSON
```

The server is the only component that talks to Gemini. Clients see one endpoint:
`POST /api/extract`. All caching, correction routing, and cost control live behind
the API boundary — not in the model, not in the client.

### Content addressing

`doc_hash = sha256(image bytes)`. Same trick git uses for blobs and HTTP uses for ETags.

- **Deterministic** — same bytes, same hash, every time.
- **Collision-resistant** — different bytes, different hash.
- **Identity** — the hash *is* the document's name.

This is why cache and corrections share one primitive: they're both "what does
the system know about *this exact input*?"

Trade-off: **byte-exact, not content-aware.** Re-encoding (Telegram, WhatsApp,
screenshots, phone picker) produces different bytes → cache miss. See
[Production notes](#production-notes) for the perceptual-hash layer that fixes this.

## File tree

```text
extract/
├── src/
│   ├── extract.ts            # image → Gemini → validated JSON
│   ├── schema.ts             # Zod schema (all fields nullable + confidence)
│   ├── server.ts             # Bun HTTP API + cache/correction routing
│   ├── corrections-db.ts     # SQLite store, keyed by doc_hash
│   └── lib/gemini.ts         # client + Zod→Gemini JSON Schema adapter
├── web/review/               # Vite + React correction UI
│   └── src/App.tsx           # field editors, confidence badges, timer
├── mobile/                   # Expo client (camera + library upload)
│   └── App.tsx
├── evals/
│   ├── generator/            # deterministic synthetic receipt generator
│   │   ├── world.ts          # 4 fictional merchants (menu, currency, tax)
│   │   ├── data.ts           # generateReceipt(seed, plan)
│   │   ├── render.ts         # ReceiptData → PNG via @napi-rs/canvas
│   │   ├── label.ts          # attach sha256(png) to ground truth
│   │   ├── index.ts          # clean set (20 docs)
│   │   └── stress.ts         # photo + hard variants
│   ├── docs/                 # generated PNG/JPG (gitignored)
│   ├── labels.jsonl          # ground truth keyed by doc_id
│   ├── per-field.ts          # per-bucket accuracy + confidence calibration
│   └── regression.ts         # corrections gate + raw-model debt report
├── data/
│   └── corrections.db        # SQLite (gitignored)
└── package.json
```

## Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Bun | Native TS, built-in SQLite, fast startup |
| Provider | Gemini (`gemini-3.5-flash-lite`) | Structured output with `responseJsonSchema` |
| Schema | Zod v4 | Native `z.toJSONSchema()`, type inference |
| Web | Vite + React 19 | Fast dev loop, no framework overhead needed |
| Mobile | Expo (Go) | iOS + Android without native builds |
| DB | `bun:sqlite` | Zero dependency, file-based, fine for this scale |
| Eval | Custom Bun scripts | No framework needed; deterministic + easy to extend |

## Setup

```bash
# prerequisites: bun, pnpm, a Gemini API key

pnpm install

cp .env.example .env
# edit .env, set GEMINI_API_KEY and GEMINI_MODEL

# generate the synthetic eval set (20 clean receipts + labels.jsonl)
pnpm generate

# add photo + hard variants
pnpm stress
```

### Run

Three terminals for the full loop:

```bash
# Terminal 1 — API server (port 3000)
pnpm server

# Terminal 2 — web correction UI (port 5173)
cd web/review && pnpm dev

# Terminal 3 — mobile (optional)
cd mobile && pnpm start
```

Then open `http://localhost:5173`. Mobile uses Expo Go; the app auto-detects
the server from Expo's `hostUri`, so both devices need to be on the same WiFi.

### Environment

```bash
GEMINI_API_KEY=...               # required
GEMINI_MODEL=gemini-3.5-flash-lite
WEB_ORIGIN=http://localhost:5173 # CORS allow-origin for the web app
SERVER_URL=http://localhost:3000 # used by evals/regression.ts
```

## Dev workflow

### Generate the eval set

```bash
pnpm generate    # 20 clean receipts → evals/docs/*.png + evals/labels.jsonl
pnpm stress      # + 20 photo variants, + 10 hard variants
```

The generator emits **doc + label together** from one code path. This is
non-negotiable: if you can generate a doc without its ground truth, the eval
set will silently drift out of sync with reality.

The generator controls variance deliberately: 4 merchants, 4 currencies
(including `other`), 1–6 items per receipt, and injected nulls (2 null dates,
1 null currency, 2 null line-item amounts, 3 discounts). The clean bucket is
not "20 identical easy receipts" — it's a small but real distribution.

### Run the eval

```bash
pnpm eval           # per-bucket: clean / photo / hard
pnpm regression     # corrections gate (server must be running)
pnpm evals          # both
```

Every extraction is cached by `doc_hash` under `evals/raw/`. Re-runs are instant.
Use `--no-cache` to force fresh extraction.

### Correct a doc

1. Open the web UI, pick a doc.
2. Fix whatever's wrong.
3. Save. Timer records time-to-correct.
4. Next load of the same doc (any client) returns the correction, not the model output.

### Break-then-restore (verify the gate)

To confirm the regression test has teeth, temporarily bypass `getCorrection` in
`src/server.ts`. `pnpm regression` should fail with:

```text
r_0018: served, but not from correction
```

Restore. Should pass again.

## Results

### Clean bucket (20 docs)

| Field | Accuracy |
|---|---|
| merchant / date / total / currency | 100% |
| line_items length match | 95% |
| line_items description / amount | 93.9% |

**Interpretation:** pipeline works end-to-end. The 5% line-item miss is one doc
(`r_0018`) where the model drops the item whose amount is unreadable. Logged as
a known bug, not fixed by prompt-tuning.

### Photo bucket (20 docs)

Same accuracy as clean. **The transform is too mild.** If photo ≈ clean, photo
is not a separate bucket — it's a duplicate. Fix by increasing rotation, blur,
and JPEG quality in `evals/generator/stress.ts`.

### Hard bucket (10 docs)

| Field | Accuracy |
|---|---|
| merchant | 60% |
| date | **20%** |
| total | 70% |
| currency | 80% |
| line_items length match | 70% |

**Failure patterns:**

- **Systematic date hallucination.** Two docs read `2025` as `2023`. Same
  direction, same magnitude — a blur artifact on the digit `5`, not random noise.
- **Occlusion cascade.** Four docs with the merchant area covered return `null`
  for **every** field, not just merchant. Model "gives up" on whole-document
  extraction when one field is heavily occluded.
- **Under-extraction, not hallucination.** `extra: 0, missing: 9` — the model
  drops items rather than inventing them. A more conservative failure mode, but
  still a failure.

### Confidence calibration (hard bucket)

| Field | High-conf accuracy | Low-conf accuracy | Verdict |
|---|---|---|---|
| merchant | 71.4% (5/7) | 33.3% (1/3) | **works** — 38pp gap |
| date | **25.0% (2/8)** | 0% (0/2) | **theatre** — 6/8 high-conf wrong |
| total | 75.0% (6/8) | 50.0% (1/2) | weak signal |
| currency | 75.0% (6/8) | 100% (2/2) | **inverted** |

Aggregate "55.6% wrong on low confidence" hides the real story: **confidence is
broken on `date`, the field that's most broken.** 12 fields marked high-confidence
are wrong on the hard bucket — errors a human reviewer following the
"check low-confidence only" workflow would silently accept.

**Blueprint rule:** *"if the confidence signal is useless, remove it."*
Not acted on because the signal is field-dependent (merchant works) and because
the hard bucket's labels don't yet encode visibility (see below).

## Known gaps

Each of these is documented honestly because the value of an eval is in what it
tells you it *cannot* measure.

1. **Hard-bucket labels assume all fields are visible.** When the transform
   occludes the date, the label still says the date is `"2025-05-15"` and the
   model's `null` is scored as a failure. The model is being penalized for correct
   abstention. Fix: add a per-field `visibility: "present" | "unreadable" | "absent"`
   to labels, and score `null` against `unreadable` as correct.
2. **Photo transform is too mild.** 100% on photo ≈ 100% on clean. Not a bucket.
3. **`r_0018` null-amount drop is unresolved.** Model drops items whose amount is
   blank instead of returning `{description, amount: null}`. Logged since S3.
4. **No held-out split.** All 20 docs are dev. Tuning a prompt on this set will
   produce optimistic numbers. A held-out set is the only defense.
5. **Byte-exact cache misses on re-encoding.** Telegram/WhatsApp/screenshots produce
   different bytes → cache miss → Gemini call. By design for L1, fixed by L2 in production.
6. **Synthetic clean docs overestimate real-world accuracy.** The generator produces
   regular layouts and consistent fonts. Real receipts are messier. This is why
   the hard bucket exists and why it's the one that fails.

## Production notes

This section is not implemented, but it's the roadmap any real deployment needs.

### Cache layers (L1 → L3)

L1 is what ships. L2 and L3 are additions, not rewrites — same DB, same hash-keyed
lookup pattern, just more indexes.

| Layer | Key | Cost | Catches | Misses |
|---|---|---|---|---|
| **L1 — SHA-256(bytes)** | Exact byte hash | ~0ms | Literal re-uploads | Any re-encoding |
| **L2 — pHash/dHash** | 64-bit visual fingerprint | ~10ms | Re-encoded, resized, lightly cropped | Perspective/lighting changes |
| **L3 — CLIP embedding** | 512-dim vector + threshold | ~50–100ms + vector DB | Same receipt re-photographed | Visually similar different receipts |

**Recommendation:** add L2 first. ~30 lines of code, no API cost, catches the
most common production miss (re-encoded images). L3 only when re-photographs
dominate; the false-positive risk (serving the wrong extraction) grows with it.

**Never lower a threshold to force a hit.** A false hit is a silent wrong answer
that the user won't know to correct — worse than paying for a Gemini call.

### Cost math

At 10k receipts/day, `$0.002` per extraction:

| Strategy | API calls/day | Daily cost |
|---|---|---|
| L1 only | ~9,700 | ~$19 |
| L1 + L2 | ~7,000 | ~$14 |
| L1 + L2 + L3 | ~6,800 | ~$13.60 |

L2 does the heavy lifting. The pHash function pays for itself day one.

### Monitor at scale

You cannot review every doc. At production volume, monitor distributions:

| Signal | What it tells you |
|---|---|
| **Input null-rate per source** | If `date` null-rate jumps from 5% to 30% for a source, that source's inputs got harder |
| **Confidence distribution** | If `high` confidence becomes less accurate over time, the model is miscalibrating |
| **Failure taxonomy counts** | Cluster sampled errors weekly; new clusters = new failure modes |
| **Sampled LLM judge** | 5–10% of live traffic through a cheap judge; 1–5% of *that* through a frontier judge |

If accuracy drops, ask *which axis moved*: input distribution, model behavior, or
the eval itself. A small frozen gold set + monitors answers this in minutes.
