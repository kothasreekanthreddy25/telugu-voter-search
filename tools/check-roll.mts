// Usage: npx tsx tools/check-roll.mts <roll.pdf> — runs the app's own parsing and name search on a real roll.
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { joinReadings, parseCards, toItems } from '../lib/rollindex';
import { nameMatch, skeleton } from '../lib/fuzzy';

const rows: { file: string; page: number; col: number; row: number; serial: string; id: string; nameKey: string; relKey: string; raw: string }[] = [];
for (const file of process.argv[2].split('|')) {
const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true }).promise;
for (let p = 1; p <= pdf.numPages; p++) {
  const tc = await (await pdf.getPage(p)).getTextContent();
  const items = toItems(tc.items as any[]);
  for (const c of parseCards(items)) {
    const name = joinReadings(c.ocrName, c.name), rel = joinReadings(c.ocrRelation, c.relation);
    rows.push({ file: file.split(/[\/]/).pop()!, page: p, col: c.col + 1, row: c.row, serial: c.serial, id: c.id, nameKey: skeleton(name), relKey: skeleton(rel), raw: name });
  }
}
}
const sn = rows.map((r) => Number(r.serial)).filter(Number.isFinite);
console.log('serials', Math.min(...sn), '-', Math.max(...sn), '| distinct ids:', new Set(rows.map((r) => r.id)).size);
{ const have = new Set(sn); const lo = Math.min(...sn), hi = Math.max(...sn); const gaps: number[] = []; for (let i = lo; i <= hi; i++) if (!have.has(i)) gaps.push(i); console.log('missing serials in range:', gaps.length, gaps.slice(0, 30).join(',')); }
const pagesEmpty = new Map<number, number>(); for (const r of rows.filter((x) => !x.nameKey)) pagesEmpty.set(r.page, (pagesEmpty.get(r.page) ?? 0) + 1);
console.log('pages with empty names:', [...pagesEmpty].map(([p, n]) => p + ':' + n).join(' '));
console.log('cards indexed:', rows.length, '| empty name keys:', rows.filter((r) => !r.nameKey).length);

for (const r of rows.filter((x) => x.serial === (process.env.SERIAL ?? '')))
  console.log('SERIAL', r.serial, 'page', r.page, 'col', r.col, 'raw', JSON.stringify(r.raw), 'key', r.nameKey);
const queries = (process.argv[3] ?? 'వర ప్రసాద్ ఆలూరి|బాలరాజు|కోటేశ్వరమ్మ|మాలకొండయ్య|ప్రేమల|balaraju|narayana|s|zzzz').split('|');
for (const q of queries) {
  // same rule as the app: voters matching every word first, partial matches only when nobody does
  const all = rows.map((r) => ({ r, m: nameMatch(r.nameKey, q) })).filter((h) => h.m);
  const best = Math.min(...all.map((h) => h.m!.missing));
  const hits = all.filter((h) => h.m!.missing === best).map((h) => ({ r: h.r, d: h.m!.cost })).sort((a, b) => a.d - b.d);
  const top = hits.slice(0, 40).map((h) => `#${h.r.serial} p${h.r.page}/c${h.r.col} d=${h.d} ${h.r.raw.slice(0, 26)}`).join('\n   ');
  console.log(`"${q}" -> ${hits.length} match(es) [best missing words: ${best}]  ${top}`);
}
process.exit(0);
