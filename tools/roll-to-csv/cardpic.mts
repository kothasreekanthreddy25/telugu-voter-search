// Usage: npx tsx cardpic.mts <roll.pdf> <outDir> <serial> [serial ...]  — saves the picture of each card as PNG.
import { readFileSync, writeFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseCards, toItems } from '../../lib/rollindex';
const [, , file, outDir, ...serials] = process.argv;
const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true }).promise;
const want = new Set(serials);
for (let p = 1; p <= pdf.numPages && want.size; p++) {
  const page = await pdf.getPage(p);
  const cards = parseCards(toItems((await page.getTextContent()).items as any[])).filter((c) => want.has(c.serial));
  if (!cards.length) continue;
  const S = 2.5, vp = page.getViewport({ scale: S });
  const big = createCanvas(Math.round(vp.width), Math.round(vp.height));
  await page.render({ canvasContext: big.getContext('2d') as any, viewport: vp, canvas: big as any }).promise;
  const H = page.getViewport({ scale: 1 }).height;
  for (const c of cards) {
    const w = Math.round(175 * S), h = Math.round(74 * S), crop = createCanvas(w, h);
    crop.getContext('2d').drawImage(big, (c.x0 - 3) * S, (H - (c.rowY + 9)) * S, w, h, 0, 0, w, h);
    writeFileSync(`${outDir}/card-${c.serial}.png`, crop.toBuffer('image/png'));
    console.log('saved', c.serial, 'pdf page', p);
    want.delete(c.serial);
  }
}
process.exit(0);
