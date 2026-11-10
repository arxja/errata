import type { Receipt } from "@errata/schema";

export const API_BASE = "http://localhost:3000";

export type DocMeta = { doc_id: string };
export type DocResponse = {
  doc_id: string;
  doc_hash: string;
  extraction: Receipt;
  original_extraction: Receipt | null;
  from_correction: boolean;
};

export async function listDocs(): Promise<DocMeta[]> {
  const r = await fetch(`${API_BASE}/api/docs`);
  if (!r.ok) throw new Error("listDocs failed");
  return r.json();
}

export async function getDoc(docId: string): Promise<DocResponse> {
  const r = await fetch(`${API_BASE}/api/docs/${docId}`);
  if (!r.ok) throw new Error("getDoc failed");
  return r.json();
}

export async function saveCorrection(
  docId: string,
  original: Receipt,
  corrected: Receipt,
  duration_ms: number
): Promise<void> {
  const r = await fetch(`${API_BASE}/api/docs/${docId}/corrections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ original, corrected, duration_ms }),
  });
  if (!r.ok) throw new Error("saveCorrection failed");
}

export function imageUrl(docId: string): string {
  return `${API_BASE}/docs/${docId}.png`;
}