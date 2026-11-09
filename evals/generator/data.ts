import { MERCHANTS, type Currency, type Merchant } from "./world";

export type ReceiptData = {
  merchant: string | null;
  date: string | null;
  total: number | null;
  currency: Currency | null;
  line_items: Array<{ description: string | null; amount: number | null }>;
};

export type Plan = {
  merchantId: string;
  itemCount: number;
  nullDate?: boolean;
  nullCurrency?: boolean;
  discount?: boolean;
  nullAmountIndex?: number;
};

export type RenderOpts = {
  address: string;
  taxRate: number;
  symbol: string;
  discount: number;
};

export function buildPlan(): Plan[] {
  const merchantIds = MERCHANTS.map((m) => m.id);
  const plan: Plan[] = [];
  for (let i = 0; i < 20; i++) {
    plan.push({
      merchantId: merchantIds[i % 4],
      itemCount: (i % 6) + 1,
    });
  }
  plan[3].discount = true;
  plan[9].discount = true;
  plan[16].discount = true;
  plan[7].nullDate = true;
  plan[14].nullDate = true;
  plan[11].nullCurrency = true;
  plan[4].nullAmountIndex = 4;
  plan[17].nullAmountIndex = 2;
  return plan;
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickItems(
  merchant: Merchant,
  count: number,
  rand: () => number
): { name: string; price: number }[] {
  const pool = [...merchant.items];
  const out: { name: string; price: number }[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(rand() * pool.length);
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

function dateForSeed(seed: number): string {
  const base = Date.UTC(2025, 0, 1);
  const offset = (seed * 17) % 365;
  return new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function generateReceipt(
  seed: number,
  plan: Plan
): { data: ReceiptData; render: RenderOpts } {
  const merchant = MERCHANTS.find((m) => m.id === plan.merchantId);
  if (!merchant) throw new Error(`unknown merchant: ${plan.merchantId}`);

  const rand = mulberry32(seed);
  const picked = pickItems(merchant, plan.itemCount, rand);

  const items = picked.map((m, i) => ({
    description: m.name,
    amount: plan.nullAmountIndex === i ? null : m.price,
  }));

  const subtotal = round2(items.reduce((s, it) => s + (it.amount ?? 0), 0));
  const discount = plan.discount ? round2(subtotal * 0.1) : 0;
  const tax = round2((subtotal - discount) * merchant.taxRate);
  const total = round2(subtotal - discount + tax);

  return {
    data: {
      merchant: merchant.name,
      date: plan.nullDate ? null : dateForSeed(seed),
      total,
      currency: plan.nullCurrency ? null : merchant.currency,
      line_items: items,
    },
    render: {
      address: merchant.address,
      taxRate: merchant.taxRate,
      symbol: plan.nullCurrency ? "" : merchant.symbol,
      discount,
    },
  };
}