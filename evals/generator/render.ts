import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { ReceiptData, RenderOpts } from "./data";

const W = 400;
const H = 520;
const PAD = 20;

export function renderReceipt(data: ReceiptData, opts: RenderOpts): Buffer {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#fbfbf7";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#111";

  let y = PAD + 20;

  ctx.font = "bold 22px monospace";
  ctx.textAlign = "center";
  ctx.fillText(data.merchant ?? "(unknown)", W / 2, y);
  y += 22;

  ctx.font = "12px monospace";
  ctx.fillText(opts.address, W / 2, y);
  y += 20;

  ctx.font = "bold 14px monospace";
  ctx.fillText("*** RECEIPT ***", W / 2, y);
  y += 18;

  if (data.date) {
    ctx.font = "14px monospace";
    ctx.fillText(data.date, W / 2, y);
    y += 20;
  }

  separator(ctx, y);
  y += 12;

  ctx.font = "15px monospace";
  for (const item of data.line_items) {
    itemRow(ctx, y, item.description ?? "", item.amount, opts.symbol);
    y += 22;
  }

  separator(ctx, y);
  y += 14;

  const subtotal = round2(
    data.line_items.reduce((s, it) => s + (it.amount ?? 0), 0),
  );
  const tax = round2((subtotal - opts.discount) * opts.taxRate);

  ctx.font = "15px monospace";
  amountRow(ctx, y, "Subtotal", opts.symbol, subtotal);
  y += 20;

  if (opts.discount > 0) {
    amountRow(ctx, y, "Discount", opts.symbol, -opts.discount);
    y += 20;
  }

  amountRow(ctx, y, "Tax", opts.symbol, tax);
  y += 20;

  ctx.font = "bold 17px monospace";
  amountRow(ctx, y, "TOTAL", opts.symbol, data.total ?? 0);
  y += 26;

  separator(ctx, y);
  y += 18;

  ctx.font = "13px monospace";
  ctx.textAlign = "center";
  ctx.fillText("Thank you!", W / 2, y);

  return canvas.toBuffer("image/png");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function separator(ctx: SKRSContext2D, y: number): void {
  ctx.font = "13px monospace";
  ctx.textAlign = "center";
  ctx.fillText("- - - - - - - - - - - - - - - -", W / 2, y);
}

function itemRow(
  ctx: SKRSContext2D,
  y: number,
  desc: string,
  amount: number | null,
  symbol: string,
): void {
  ctx.textAlign = "left";
  ctx.fillText(desc, PAD, y);
  if (amount === null) return;

  const amtStr = symbol + amount.toFixed(2);
  ctx.textAlign = "right";
  ctx.fillText(amtStr, W - PAD, y);

  const amtW = ctx.measureText(amtStr).width;
  const descW = ctx.measureText(desc).width;
  const startX = PAD + descW + 4;
  const endX = W - PAD - amtW - 4;
  if (endX - startX > 10) {
    ctx.textAlign = "left";
    const dotW = ctx.measureText(".").width;
    const count = Math.max(0, Math.floor((endX - startX) / dotW));
    if (count > 0) ctx.fillText(".".repeat(count), startX, y);
  }
}

function amountRow(
  ctx: SKRSContext2D,
  y: number,
  label: string,
  symbol: string,
  amount: number,
): void {
  ctx.textAlign = "left";
  ctx.fillText(label, PAD, y);
  ctx.textAlign = "right";
  const sign = amount < 0 ? "-" : "";
  ctx.fillText(sign + symbol + Math.abs(amount).toFixed(2), W - PAD, y);
}
