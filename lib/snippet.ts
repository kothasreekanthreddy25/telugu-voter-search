import type { Voter } from './types';
import { cardSrc, saveCard } from './cards';
import { openStoredRoll } from './store';
import { CARD_H, CARD_W, COL_X0 } from './rollindex';

const SCALE = 2.2;

/** Cutting pictures out of a page is memory-hungry, so they are made one at a time. */
let queue: Promise<unknown> = Promise.resolve();

async function cut(v: Voter): Promise<string | null> {
  const pdf = await openStoredRoll(v.listId!);
  const page = await pdf.getPage(v.pdfPage!);
  const pageH = page.getViewport({ scale: 1 }).height;
  const left = COL_X0[v.col! - 1] - 3;
  const top = pageH - (v.cardY! + 9);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(CARD_W * SCALE);
  canvas.height = Math.round(CARD_H * SCALE);
  
  // The transform shifts the page so that only this card lands on the small canvas (and only its photo is decoded).
  const viewport = page.getViewport({ scale: SCALE });
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport, transform: [1, 0, 0, 1, -left * SCALE, -top * SCALE], canvas } as any).promise;
  page.cleanup();

  const jpeg = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Image failed'))), 'image/jpeg', 0.8));
  await saveCard(v.img!, jpeg);
  return cardSrc(v.img!);
}

/** The picture of a voter's card: reuses the saved one, otherwise cuts it out of the stored PDF. */
export async function getSnippet(v: Voter): Promise<string | null> {
  if (!v.img) return null;
  const have = await cardSrc(v.img);
  if (have) return have;
  if (v.cardY == null || !v.pdfPage || !v.col || !v.listId) return null;
  const job = queue.then(() => cut(v)).catch((e) => { console.warn('Could not cut out card picture', e); return null; });
  queue = job;
  return job;
}
