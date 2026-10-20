// Usage: node convert.mjs <roll.pdf> <out.csv> [firstPage] [lastPage]
// The roll's embedded Telugu text is corrupted (broken font mapping), but its ASCII fields (IDs, serials,
// house numbers, ages) are exact. So: read those from the text layer, and OCR (Telugu) only the name lines.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createWorker } from 'tesseract.js';

const [, , pdfPath, outPath, first = '1', last = '9999'] = process.argv;
if (!pdfPath || !outPath) throw new Error('Usage: node convert.mjs <roll.pdf> <out.csv> [firstPage] [lastPage]');
const langPath = join(dirname(fileURLToPath(import.meta.url)), 'lang');

const SCALE = 5; // ~360 dpi: OCR accuracy matters more than speed
const COL_X0 = [39, 216, 393]; // left text edge of each card column (PDF points)
const WORKERS = 4;

const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)), useSystemFonts: true }).promise;
const workers = await Promise.all(
  Array.from({ length: WORKERS }, async () => {
    const w = await createWorker('tel', 1, { langPath, gzip: false });
    await w.setParameters({ tessedit_pageseg_mode: '7', preserve_interword_spaces: '1' });
    return w;
  }),
);

const csvCell = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
writeFileSync(outPath, '﻿serial,name,relation,age,gender,house,voter_id,part,assembly_serial\n');

function parseCards(items) {
  const cards = [];
  for (let col = 0; col < 3; col++) {
    const x0 = COL_X0[col];
    const inCol = (i) => i.x >= x0 - 4 && i.x < x0 + 170;
    const heads = items.filter((i) => inCol(i) && /^\d{3,5}$/.test(i.s) && i.x >= x0 + 50 && i.x <= x0 + 66);
    for (const h of heads) {
      const line = (dy, minX = x0 - 4) => items.filter((i) => inCol(i) && Math.abs(i.y - (h.y - dy)) <= 3 && i.x >= minX).sort((a, b) => a.x - b.x);
      const asm = line(0, x0 + 85).map((i) => i.s).join('').match(/(\d+)-(\d+)-(\d+)/);
      const ageLine = line(37);
      const age = ageLine.map((i) => i.s).join(' ').match(/:\s*(\d+)/)?.[1] ?? '';
      const gender = ageLine.some((i) => i.x > x0 + 85 && i.s.trim() === 'పు') ? 'M' : 'F';
      const house = line(49, x0 + 40).map((i) => i.s).join('').replace(/^\s*:\s*/, '').trim();
      const id = line(61).map((i) => i.s).join(' ').match(/[A-Z]{2,3}\d{6,8}/)?.[0] ?? '';
      if (!id) continue; // page footers etc. also contain 3-5 digit numbers; real cards always have an EPIC number
      cards.push({ col, x0, hy: h.y, serial: h.s, part: asm?.[2] ?? '', asmSerial: asm?.[3] ?? '', age, gender, house, id });
    }
  }
  return cards;
}

async function cropPng(bigCanvas, x, yTop, w, h) {
  const c = createCanvas(Math.round(w * SCALE) + 40, Math.round(h * SCALE) + 40);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bigCanvas, Math.round(x * SCALE), Math.round(yTop * SCALE), Math.round(w * SCALE), Math.round(h * SCALE), 20, 20, Math.round(w * SCALE), Math.round(h * SCALE));
  return c.toBuffer('image/png');
}

// OCR noise: zero-width joiners, box/photo-edge glyphs ("|", stray 1-2 character tokens at the end of the line).
function clean(t) {
  const s = t.replace(/[​-‍]/g, '').replace(/[|\[\]]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s:;]+/, '').trim();
  const words = s.split(' ');
  while (words.length > 1 && [...words[words.length - 1]].length <= 2) words.pop();
  return words.join(' ');
}

let total = 0, noText = 0;
for (let p = Number(first); p <= Math.min(Number(last), pdf.numPages); p++) {
  const page = await pdf.getPage(p);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = tc.items.filter((i) => i.str.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5] }));
  const cards = parseCards(items);
  if (!cards.length) { noText++; console.log(`page ${p}: no voter cards, skipped`); continue; }

  const big = createCanvas(Math.round(vp.width * SCALE), Math.round(vp.height * SCALE));
  await page.render({ canvasContext: big.getContext('2d'), viewport: page.getViewport({ scale: SCALE }), canvas: big }).promise;

  // Two crops per card: voter name (baseline hy-12) and father/husband/mother name (hy-25).
  const jobs = [];
  for (const c of cards) for (const [k, dy] of [['name', 12], ['relation', 25]]) jobs.push({ c, k, dy });
  let next = 0;
  await Promise.all(workers.map(async (w) => {
    while (next < jobs.length) {
      const { c, k, dy } = jobs[next++];
      const yTop = vp.height - (c.hy - dy) - 10;
      const png = await cropPng(big, c.x0 + 43, yTop, 83, 14.5);
      c[k] = clean((await w.recognize(png)).data.text);
      if (!c[k]) { // retry as a text block, then with a wider crop
        await w.setParameters({ tessedit_pageseg_mode: '6' });
        c[k] = clean((await w.recognize(await cropPng(big, c.x0 + 40, yTop - 2, 86, 18))).data.text);
        await w.setParameters({ tessedit_pageseg_mode: '7' });
      }
    }
  }));

  for (const c of cards.sort((a, b) => Number(a.serial) - Number(b.serial))) {
    appendFileSync(outPath, [c.serial, c.name, c.relation, c.age, c.gender, c.house, c.id, c.part, c.asmSerial].map(csvCell).join(',') + '\n');
    total++;
  }
  console.log(`page ${p}: ${cards.length} cards (total ${total})`);
}
await Promise.all(workers.map((w) => w.terminate()));
console.log(`done: ${total} voters -> ${outPath}`);
