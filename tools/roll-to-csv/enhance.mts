// Usage: node --max-old-space-size=12000 --import tsx enhance.mts <out.pdf> <roll1.pdf> [roll2.pdf ...]
//
// The Telugu text inside these rolls is corrupted (and diagonal watermarks overwrite some names), so names cannot be
// searched reliably. This tool reads every voter's name and father/husband name from the printed card with Telugu OCR
// and writes them back into a combined copy of the PDF as INVISIBLE ASCII text ("~N sunit vaka"). The app reads
// those tokens when it imports the file, so people upload one ordinary PDF and nothing else is needed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createWorker } from 'tesseract.js';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { OCR_NAME, OCR_RELATION, parseCards, toItems } from '../../lib/rollindex';
import { romanize } from '../../lib/fuzzy';

const [, , outPath, ...inputs] = process.argv;
if (!outPath || !inputs.length) throw new Error('Usage: enhance.mts <out.pdf> <roll1.pdf> [roll2.pdf ...]');
const here = dirname(fileURLToPath(import.meta.url));
const langPath = join(here, 'lang');
const SCALE = 4;
const WORKERS = 8;

const workers = await Promise.all(Array.from({ length: WORKERS }, async () => {
  const w = await createWorker('tel', 1, { langPath, gzip: false });
  await w.setParameters({ tessedit_pageseg_mode: '7' as any, preserve_interword_spaces: '1' });
  return w;
}));

/** OCR noise: zero-width joiners, box/photo-edge glyphs, stray one or two character tokens at the end of the line. */
function clean(t: string) {
  const s = t.replace(/[​-‍]/g, '').replace(/[|\[\]]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s:;]+/, '').trim();
  const words = s.split(' ');
  while (words.length > 1 && [...words[words.length - 1]].length <= 2) words.pop();
  return words.join(' ');
}

function crop(big: ReturnType<typeof createCanvas>, x: number, yTop: number, w: number, h: number) {
  const c = createCanvas(Math.round(w * SCALE) + 40, Math.round(h * SCALE) + 40);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(big, Math.round(x * SCALE), Math.round(yTop * SCALE), Math.round(w * SCALE), Math.round(h * SCALE), 20, 20, Math.round(w * SCALE), Math.round(h * SCALE));
  return c.toBuffer('image/png');
}

type Result = Record<string, { name: string; relation: string }>; // keyed by "<file>|<page>|<serial>"
const cachePath = outPath + '.ocr-cache.json';
const cache: Result = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};

let done = 0;
for (const input of inputs) {
  const label = input.split(/[\\/]/).pop()!;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(input)), useSystemFonts: true }).promise;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const cards = parseCards(toItems((await page.getTextContent()).items as any[]));
    const todo = cards.filter((c) => !cache[`${label}|${p}|${c.serial}`]);
    if (todo.length) {
      const vp = page.getViewport({ scale: SCALE });
      const big = createCanvas(Math.round(vp.width), Math.round(vp.height));
      await page.render({ canvasContext: big.getContext('2d') as any, viewport: vp, canvas: big as any }).promise;
      const pageH = page.getViewport({ scale: 1 }).height;
      const jobs = todo.flatMap((c) => [{ c, k: 'name' as const, y: c.nameY }, { c, k: 'relation' as const, y: c.relY }]);
      const out = new Map<string, { name: string; relation: string }>();
      let next = 0;
      await Promise.all(workers.map(async (w) => {
        while (next < jobs.length) {
          const { c, k, y } = jobs[next++];
          const yTop = pageH - y - 10;
          let text = clean((await w.recognize(crop(big, c.x0 + 43, yTop, 83, 14.5))).data.text);
          if (!text) { // retry as a text block on a slightly larger crop
            await w.setParameters({ tessedit_pageseg_mode: '6' as any });
            text = clean((await w.recognize(crop(big, c.x0 + 40, yTop - 2, 86, 18))).data.text);
            await w.setParameters({ tessedit_pageseg_mode: '7' as any });
          }
          const key = `${label}|${p}|${c.serial}`;
          const cur = out.get(key) ?? { name: '', relation: '' };
          cur[k] = text;
          out.set(key, cur);
        }
      }));
      for (const [k, v] of out) cache[k] = v;
      writeFileSync(cachePath, JSON.stringify(cache));
    }
    done += cards.length;
    console.log(`${label} page ${p}/${pdf.numPages}: ${cards.length} cards (OCR'd so far ${done})`);
  }
}
await Promise.all(workers.map((w) => w.terminate()));

// Build the combined PDF and add the invisible name text.
console.log('merging and writing names into the PDF ...');
const merged = await PDFDocument.create();
const font = await merged.embedFont(StandardFonts.Helvetica);
let pageNo = 0, written = 0;
for (const input of inputs) {
  const label = input.split(/[\\/]/).pop()!;
  const src = await PDFDocument.load(readFileSync(input), { updateMetadata: false });
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(input)), useSystemFonts: true }).promise;
  const copied = await merged.copyPages(src, src.getPageIndices());
  for (let i = 0; i < copied.length; i++) {
    const page = merged.addPage(copied[i]);
    const cards = parseCards(toItems((await (await pdf.getPage(i + 1)).getTextContent()).items as any[]));
    for (const c of cards) {
      const r = cache[`${label}|${i + 1}|${c.serial}`];
      if (!r) continue;
      const draw = (text: string, y: number) => text && page.drawText(text, { x: c.x0 + 2, y, size: 5, font, opacity: 0 });
      draw(r.name && OCR_NAME + romanize(r.name), c.hy - 7);
      draw(r.relation && OCR_RELATION + romanize(r.relation), c.hy - 14);
      written++;
    }
    pageNo++;
  }
  console.log(label, 'merged,', pageNo, 'pages so far');
}
writeFileSync(outPath, await merged.save({ useObjectStreams: true }));
console.log(`written ${outPath}: ${pageNo} pages, names added for ${written} voters`);
process.exit(0);
