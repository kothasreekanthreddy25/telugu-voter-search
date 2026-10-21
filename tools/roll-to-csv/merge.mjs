// Usage: node --max-old-space-size=8192 merge.mjs <out.pdf> <in1.pdf> <in2.pdf> ...
import { readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

const [, , out, ...inputs] = process.argv;
const merged = await PDFDocument.create();
for (const f of inputs) {
  const src = await PDFDocument.load(readFileSync(f), { updateMetadata: false });
  const pages = await merged.copyPages(src, src.getPageIndices());
  pages.forEach((p) => merged.addPage(p));
  console.log(f.split(/[\/]/).pop(), '->', pages.length, 'pages (total', merged.getPageCount() + ')');
}
writeFileSync(out, await merged.save({ useObjectStreams: true }));
console.log('written', out);
