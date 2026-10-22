// Usage: npx tsx unreadable.mts <outPrefix> <roll1.pdf> [roll2.pdf ...]
// Lists the voters whose name cannot be read from the PDF text, and builds a PDF with just their cards
// (cut out of the pages as pictures) so the names can be read and typed in by a person.
import { readFileSync, writeFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { parseCards, type Item } from '../../lib/rollindex';
import { skeleton } from '../../lib/fuzzy';

const [, , outPrefix, ...files] = process.argv;
const SCALE = 2.2;
const CARD_W = 175, CARD_H = 74;

interface Entry { serial: number; file: string; pdfPage: number; printedPage: string; col: number; row: number; id: string; house: string; jpeg: Buffer }
const entries: Entry[] = [];
let total = 0;

for (const path of files) {
  const label = path.split(/[\\/]/).pop()!;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true }).promise;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items: Item[] = (tc.items as any[]).filter((i) => 'str' in i && i.str.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
    const cards = parseCards(items);
    total += cards.length;
    const bad = cards.filter((c) => !skeleton(c.name));
    if (!bad.length) continue;
    const printed = items.find((i) => i.y < 60 && /^\d+\/\d+$/.test(i.s.trim()))?.s.trim().split('/')[0] ?? String(p);
    const vp = page.getViewport({ scale: SCALE });
    const big = createCanvas(Math.round(vp.width), Math.round(vp.height));
    await page.render({ canvasContext: big.getContext('2d') as any, viewport: vp, canvas: big as any }).promise;
    const pageH = page.getViewport({ scale: 1 }).height;
    for (const c of bad) {
      const w = Math.round(CARD_W * SCALE), h = Math.round(CARD_H * SCALE);
      const crop = createCanvas(w, h);
      crop.getContext('2d').drawImage(big, (c.x0 - 3) * SCALE, (pageH - (c.rowY + 9)) * SCALE, w, h, 0, 0, w, h);
      entries.push({ serial: Number(c.serial), file: label, pdfPage: p, printedPage: printed, col: c.col + 1, row: c.row, id: c.id, house: c.house, jpeg: crop.toBuffer('image/jpeg', 85) });
    }
    console.log(label, 'page', p, ':', bad.length, 'unreadable');
  }
}
entries.sort((a, b) => a.serial - b.serial);
console.log(`unreadable names: ${entries.length} of ${total} voters`);

// List (CSV) with an empty Name column to be filled in
const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
writeFileSync(outPrefix + '.csv', '﻿' + ['serial,name,voter_id,house,source_file,pdf_page,printed_page,column,row',
  ...entries.map((e) => [e.serial, '', e.id, e.house, e.file, e.pdfPage, e.printedPage, e.col, e.row].map(q).join(','))].join('\n') + '\n');

// PDF of the cards
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const W = 595, H = 842, M = 30, GAP = 14, COLS = 2, ROWS = 6;
const cw = (W - 2 * M - GAP) / COLS, ch = cw * CARD_H / CARD_W, rowH = ch + 18;
const perPage = COLS * ROWS;
for (let i = 0; i < entries.length; i++) {
  if (i % perPage === 0) {
    const pg = doc.addPage([W, H]);
    pg.drawText(`Voters whose names could not be read from the PDF text (${entries.length})`, { x: M, y: H - 28, size: 12, font: bold });
    pg.drawText(`Sorted by serial number. Page ${Math.floor(i / perPage) + 1} of ${Math.ceil(entries.length / perPage)}`, { x: M, y: H - 42, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
  }
  const pg = doc.getPage(doc.getPageCount() - 1);
  const k = i % perPage, col = k % COLS, row = Math.floor(k / COLS);
  const x = M + col * (cw + GAP), top = H - 62 - row * rowH;
  const e = entries[i];
  pg.drawText(`Serial ${e.serial}  |  ${e.file}, PDF page ${e.pdfPage} (printed ${e.printedPage}), column ${e.col}, row ${e.row}`, { x, y: top - 8, size: 7, font });
  const img = await doc.embedJpg(e.jpeg);
  pg.drawImage(img, { x, y: top - 12 - ch, width: cw, height: ch });
}
writeFileSync(outPrefix + '.pdf', await doc.save());
console.log('written', outPrefix + '.pdf', 'and', outPrefix + '.csv');
process.exit(0);
