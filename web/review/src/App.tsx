import { useEffect, useMemo, useRef, useState } from "react";
import type { Receipt } from "@extract/schema";
import * as api from "./api";

const TARGET_SECONDS = 30;

export default function App() {
  const [docs, setDocs] = useState<api.DocMeta[]>([]);
  const [currentDoc, setCurrentDoc] = useState<string | null>(null);
  const [original, setOriginal] = useState<Receipt | null>(null);
  const [draft, setDraft] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSave, setLastSave] = useState<{ seconds: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startTime = useRef<number>(0);

  useEffect(() => {
    api.listDocs().then(setDocs).catch((e) => setError(String(e)));
  }, []);

  const loadDoc = async (docId: string) => {
    setLoading(true);
    setError(null);
    setLastSave(null);
    setCurrentDoc(docId);
    try {
      const res = await api.getDoc(docId);
      setOriginal(res.extraction);
      setDraft(clone(res.extraction));
      startTime.current = Date.now();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const onSave = async () => {
    if (!draft || !original || !currentDoc) return;
    setSaving(true);
    try {
      const duration_ms = Date.now() - startTime.current;
      await api.saveCorrection(currentDoc, original, draft, duration_ms);
      setLastSave({ seconds: duration_ms / 1000 });
      setOriginal(clone(draft));
      startTime.current = Date.now();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const onReset = () => {
    if (original) setDraft(clone(original));
  };

  const changedCount = useMemo(() => {
    if (!draft || !original) return 0;
    return countChanges(original, draft);
  }, [draft, original]);

  return (
    <div className="app">
      <aside className="sidebar">
        <h2>Docs</h2>
        <ul>
          {docs.map((d) => (
            <li key={d.doc_id}>
              <button
                className={d.doc_id === currentDoc ? "active" : ""}
                onClick={() => loadDoc(d.doc_id)}
                disabled={loading}
              >
                {d.doc_id}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {draft && original && currentDoc ? (
        <div className="viewer">
          <div className="image-pane">
            <img src={api.imageUrl(currentDoc)} alt={`receipt ${currentDoc}`} />
          </div>

          <div className="form-pane">
            <header className="form-header">
              <h2>{currentDoc}</h2>
              <div className="actions">
                <button onClick={onReset} disabled={saving || changedCount === 0}>
                  Reset
                </button>
                <button className="save" onClick={onSave} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
              {lastSave && (
                <div
                  className={`timer ${
                    lastSave.seconds < TARGET_SECONDS ? "ok" : "slow"
                  }`}
                >
                  Saved in {lastSave.seconds.toFixed(1)}s
                  {lastSave.seconds < TARGET_SECONDS
                    ? " ✓"
                    : ` (target <${TARGET_SECONDS}s)`}
                </div>
              )}
              {changedCount > 0 && (
                <div className="changed">{changedCount} change(s) pending</div>
              )}
              {error && <div className="error">{error}</div>}
            </header>

            <div className="fields">
              <Field
                label="Merchant"
                confidence={draft.merchant_confidence}
              >
                <input
                  value={draft.merchant ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      merchant: e.target.value || null,
                    })
                  }
                />
              </Field>

              <Field label="Date" confidence={draft.date_confidence}>
                <input
                  value={draft.date ?? ""}
                  placeholder="YYYY-MM-DD"
                  onChange={(e) =>
                    setDraft({ ...draft, date: e.target.value || null })
                  }
                />
              </Field>

              <Field label="Total" confidence={draft.total_confidence}>
                <input
                  type="number"
                  step="0.01"
                  value={draft.total ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      total: e.target.value === "" ? null : parseFloat(e.target.value),
                    })
                  }
                />
              </Field>

              <Field label="Currency" confidence={draft.currency_confidence}>
                <select
                  value={draft.currency ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      currency:
                        e.target.value === ""
                          ? null
                          : (e.target.value as NonNullable<Receipt["currency"]>),
                    })
                  }
                >
                  <option value="">(null)</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="other">other</option>
                </select>
              </Field>

              <div className="field">
                <label>
                  Line items <Conf level={draft.line_items_confidence} />
                </label>
                {draft.line_items.map((item, i) => (
                  <div className="line-item" key={i}>
                    <input
                      value={item.description ?? ""}
                      placeholder="description"
                      onChange={(e) => {
                        const next = [...draft.line_items];
                        next[i] = { ...next[i], description: e.target.value || null };
                        setDraft({ ...draft, line_items: next });
                      }}
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={item.amount ?? ""}
                      placeholder="amount"
                      onChange={(e) => {
                        const next = [...draft.line_items];
                        next[i] = {
                          ...next[i],
                          amount:
                            e.target.value === "" ? null : parseFloat(e.target.value),
                        };
                        setDraft({ ...draft, line_items: next });
                      }}
                    />
                    <button
                      onClick={() =>
                        setDraft({
                          ...draft,
                          line_items: draft.line_items.filter((_, j) => j !== i),
                        })
                      }
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  className="add-item"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      line_items: [
                        ...draft.line_items,
                        { description: null, amount: null },
                      ],
                    })
                  }
                >
                  + Add item
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="empty">
          {loading ? "Loading..." : "Pick a doc from the left"}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  confidence,
  children,
}: {
  label: string;
  confidence: "high" | "low";
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label>
        {label} <Conf level={confidence} />
      </label>
      {children}
    </div>
  );
}

function Conf({ level }: { level: "high" | "low" }) {
  return <span className={`conf ${level}`}>{level}</span>;
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function countChanges(a: Receipt, b: Receipt): number {
  let n = 0;
  if (a.merchant !== b.merchant) n++;
  if (a.date !== b.date) n++;
  if (a.total !== b.total) n++;
  if (a.currency !== b.currency) n++;
  if (JSON.stringify(a.line_items) !== JSON.stringify(b.line_items)) n++;
  return n;
}