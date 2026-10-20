import type { Voter } from './types';
import { cardPath } from './cards';
import { openPdf } from './pdf';
import { skeleton } from './fuzzy';

/**
 * Reads a card-style panchayat electoral roll (voter cards in 3 columns, serial number in each card's header).
 * Only the text layer is read here, which is fast. The roll's Telugu text is corrupted, so names serve only as an
 * approximate search key; the reliable output is WHERE a card is (page, row, column, serial). The picture of a
 * card is cut out of the stored PDF later, when someone actually searches for it (see snippet.ts).
 */
export const COL_X0 = [39, 216, 393]; // left text edge of each card column, in PDF points
export const CARD_W = 175;
export const CARD_H = 75;

type Item = { s: string; x: number; y: number; w: number };
interface Card { col: number; row: number; x0: number; hy: number; serial: string; part: string; id: string; house: string }

function parseCards(items: Item[]): Card[] {
  const cards: Card[] = [];
  for (let col = 0; col < 3; col++) {
    const x0 = COL_X0[col];
    const inCol = (i: Item) => i.x >= x0 - 4 && i.x < x0 + 170;
    const heads = items
      .filter((i) => inCol(i) && /^\d{3,5}$/.test(i.s) && i.x >= x0 + 50 && i.x <= x0 + 66)
      .sort((a, b) => b.y - a.y);
    for (const h of heads) {
      const line = (dy: number, minX = x0 - 4) =>
        items.filter((i) => inCol(i) && Math.abs(i.y - (h.y - dy)) <= 3 && i.x >= minX).sort((a, b) => a.x - b.x);
      const id = line(61).map((i) => i.s).join(' ').match(/[A-Z]{2,3}\d{6,8}/)?.[0] ?? '';
      if (!id) continue; // page furniture also contains numbers; real cards always carry an EPIC number
      const asm = line(0, x0 + 85).map((i) => i.s).join('').match(/(\d+)-(\d+)-(\d+)/);
      cards.push({
        col, row: cards.filter((c) => c.col === col).length + 1, x0, hy: h.y, serial: h.s, id, part: asm?.[2] ?? '',
        house: line(49, x0 + 40).map((i) => i.s).join('').replace(/^\s*:\s*/, '').trim(),
      });
    }
  }
  return cards;
}

const lineText = (items: Item[], c: Card, dy: number) =>
  items.filter((i) => i.x >= c.x0 + 44.5 && i.x < c.x0 + 135 && Math.abs(i.y - (c.hy - dy)) <= 3)
    .sort((a, b) => a.x - b.x).map((i) => i.s).join('');

export interface IndexProgress { page: number; total: number; cards: number }

export async function indexRoll(
  file: File,
  listId: number,
  onProgress: (p: IndexProgress) => void,
  cancelled: () => boolean = () => false,
): Promise<Voter[]> {
  const pdf = await openPdf(file);
  const voters: Voter[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    if (cancelled()) throw new Error('Cancelled');
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items: Item[] = (tc.items as any[])
      .filter((i) => 'str' in i && i.str.trim() !== '')
      .map((i) => ({ s: i.str as string, x: i.transform[4], y: i.transform[5], w: i.width }));
    const cards = parseCards(items);
    // Printed page number ("1/42") is what people see in their paper copy; it differs from the PDF page.
    const printed = items.find((i) => i.y < 60 && /^\d+\/\d+$/.test(i.s.trim()))?.s.trim().split('/')[0] ?? String(p);

    for (const c of cards) {
      const name = lineText(items, c, 12), relation = lineText(items, c, 25);
      voters.push({
        name, relation, voterId: c.id, house: c.house, part: c.part, serial: c.serial, station: '',
        page: printed, pdfPage: p, col: c.col + 1, row: c.row, cardY: c.hy, img: cardPath(listId, p, c.col + 1, c.row),
        nameKey: skeleton(name), relKey: skeleton(relation),
      });
    }
    page.cleanup();
    onProgress({ page: p, total: pdf.numPages, cards: voters.length });
  }
  await (pdf as any).destroy?.();
  if (!voters.length) throw new Error('UNSUPPORTED_LAYOUT');
  return voters;
}
