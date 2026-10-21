// Usage: npx tsx tools/check-roll.mts <roll.pdf> — runs the app's own parsing and name search on a real roll.
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { lineText, parseCards, type Item } from '../lib/rollindex';
import { nameDistance, skeleton } from '../lib/fuzzy';

const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(process.argv[2])), useSystemFonts: true }).promise;
const rows: { page: number; col: number; row: number; serial: string; id: string; nameKey: string; relKey: string; raw: string }[] = [];
for (let p = 1; p <= pdf.numPages; p++) {
  const tc = await (await pdf.getPage(p)).getTextContent();
  const items: Item[] = (tc.items as any[]).filter((i) => 'str' in i && i.str.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
  for (const c of parseCards(items)) {
    const name = lineText(items, c, 12), rel = lineText(items, c, 25);
    rows.push({ page: p, col: c.col + 1, row: c.row, serial: c.serial, id: c.id, nameKey: skeleton(name), relKey: skeleton(rel), raw: name });
  }
}
console.log('cards indexed:', rows.length, '| empty name keys:', rows.filter((r) => !r.nameKey).length);

for (const r of rows.filter((x) => x.serial === (process.env.SERIAL ?? '')))
  console.log('SERIAL', r.serial, 'page', r.page, 'col', r.col, 'raw', JSON.stringify(r.raw), 'key', r.nameKey);
const queries = (process.argv[3] ?? 'వర ప్రసాద్ ఆలూరి|బాలరాజు|కోటేశ్వరమ్మ|మాలకొండయ్య|ప్రేమల|balaraju|narayana|s|zzzz').split('|');
for (const q of queries) {
  const hits = rows.map((r) => ({ r, d: nameDistance(r.nameKey, q) })).filter((h) => h.d !== Infinity).sort((a, b) => a.d - b.d);
  const top = hits.slice(0, 40).map((h) => `#${h.r.serial} p${h.r.page}/c${h.r.col} d=${h.d}`).join('  ');
  console.log(`"${q}" -> ${hits.length} match(es)  ${top}`);
}
process.exit(0);
