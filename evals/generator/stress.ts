// Generate photo and hard variants of the existing clean receipts.
// Same content, same labels — only input quality changes.
// Photo: mild degradation (rotation, blur, JPEG). Should still be easy.
// Hard: heavy degradation (large rotation, blur, fade, occlusion, low JPEG).

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const DOCS_DIR = "evals/docs";
const PAD = 80;

type Transform = {
  rotation: number;   // degrees
  blur: number;       // pixels
  fade: number;       // 0-1, white overlay to simulate fading
  quality: number;    // JPEG quality 0-100
  occlude?: boolean;  // overlay top ~22% (merchant/date area)
};

const PHOTO: Transform[] = [
  { rotation: 3,  blur: 0.4, fade: 0.05, quality: 75 },
  { rotation: -5, blur: 0.6, fade: 0.10, quality: 70 },
  { rotation: 7,  blur: 0.5, fade: 0.08, quality: 70 },
];

const HARD: Transform[] = [
  { rotation: 14,  blur: 1.5, fade: 0.35, quality: 35 },
  { rotation: -18, blur: 2.0, fade: 0.40, quality: 30, occlude: true },
  { rotation: 22,  blur: 1.8, fade: 0.35, quality: 25 },
  { rotation: -9,  blur: 2.5, fade: 0.45, quality: 20, occlude: true },
  { rotation: 16,  blur: 1.2, fade: 0.50, quality: 40, occlude: true },
];

// Doc ids that must be in the hard bucket — they cover the interesting
// cases: null date (7, 14), null currency (11), null amount (4, 17),
// discount (3, 9, 16), and one per merchant.
const HARD_IDS = [
  "r_0003", "r_0004", "r_0005", "r_0007", "r_0009",
  "r_0011", "r_0012", "r_0014", "r_0017", "r_0018",
];

async function applyTransform(src: Buffer, t: Transform): Promise<Buffer> {
  const img = await loadImage(src);
  const W = img.width + PAD * 2;
  const H = img.height + PAD * 2;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Paper-ish background so rotated corners don't reveal black.
  ctx.fillStyle = "#efe9dc";
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate((t.rotation * Math.PI) / 180);
  if (t.blur > 0) ctx.filter = `blur(${t.blur}px)`;
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.restore();

  if (t.fade > 0) {
    ctx.fillStyle = `rgba(255,255,255,${t.fade})`;
    ctx.fillRect(0, 0, W, H);
  }

  if (t.occlude) {
    // A blurry white "fingerprint"/"tape" across the top third.
    ctx.fillStyle = "rgba(240,240,235,0.92)";
    ctx.beginPath();
    ctx.ellipse(W / 2, PAD + img.height * 0.14, img.width * 0.45, img.height * 0.10, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas.toBuffer("image/jpeg", t.quality);
}

async function main() {
  const pngs = readdirSync(DOCS_DIR)
    .filter((f) => /^r_\d+\.png$/.test(f))
    .sort();
  console.log(`clean docs: ${pngs.length}`);

  let photoCount = 0;
  let hardCount = 0;

  for (let i = 0; i < pngs.length; i++) {
    const base = pngs[i].replace(".png", "");
    const src = readFileSync(`${DOCS_DIR}/${pngs[i]}`);

    // Every clean doc gets a photo variant.
    const pt = PHOTO[i % PHOTO.length];
    writeFileSync(`${DOCS_DIR}/${base}_photo.jpg`, await applyTransform(src, pt));
    photoCount++;

    // Only the selected ids get a hard variant.
    if (HARD_IDS.includes(base)) {
      const ht = HARD[HARD_IDS.indexOf(base) % HARD.length];
      writeFileSync(`${DOCS_DIR}/${base}_hard.jpg`, await applyTransform(src, ht));
      hardCount++;
    }
  }

  console.log(`wrote ${photoCount} photo variants`);
  console.log(`wrote ${hardCount} hard variants`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});