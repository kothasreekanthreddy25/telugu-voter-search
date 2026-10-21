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
export const CARD_H = 74; // stops short of the page footer that sits just under the last row

export type Item = { s: string; x: number; y: number; w: number };
export interface Card {
  col: number; row: number; x0: number; hy: number; rowY: number;
  serial: string; part: string; id: string; house: string; name: string; relation: string;
}

const ROW_PITCH = 76.3; // distance between card rows on the page, in PDF points

/**
 * Finds every card on a page. A card's lines are found by reading order below its header, not by fixed offsets,
 * because a few cards have slightly tighter line spacing than the rest. Name = first line, father/husband =
 * second line, house number = the line above the voter-ID line.
 */
export function parseCards(items: Item[]): Card[] {
  const found: Omit<Card, 'row' | 'rowY'>[] = [];
  for (let col = 0; col < 3; col++) {
    const x0 = COL_X0[col];
    const inCol = (i: Item) => i.x >= x0 - 4 && i.x < x0 + 170;
    const heads = items
      .filter((i) => inCol(i) && /^\d{1,5}$/.test(i.s) && i.x >= x0 + 50 && i.x <= x0 + 66)
      .sort((a, b) => b.y - a.y);
    for (const h of heads) {
      const body = items.filter((i) => inCol(i) && i.y < h.y - 4 && i.y > h.y - 70).sort((a, b) => b.y - a.y || a.x - b.x);
      const lines: Item[][] = [];
      for (const it of body) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(last[0].y - it.y) <= 2.5) last.push(it);
        else lines.push([it]);
      }
      const text = (l?: Item[], minX = x0 + 44.5, maxX = x0 + 135) =>
        (l ?? []).filter((i) => i.x >= minX && i.x < maxX).sort((a, b) => a.x - b.x).map((i) => i.s).join('');
      let idAt = -1;
      lines.forEach((l, k) => { if (/[A-Z]{2,3}\d{6,8}/.test(l.map((i) => i.s).join(' '))) idAt = k; });
      if (idAt < 0) continue; // page furniture also contains numbers; real cards always carry an EPIC number
      const id = lines[idAt].map((i) => i.s).join(' ').match(/[A-Z]{2,3}\d{6,8}/)![0];
      const asm = items.filter((i) => inCol(i) && Math.abs(i.y - h.y) <= 3 && i.x >= x0 + 85).sort((a, b) => a.x - b.x)
        .map((i) => i.s).join('').match(/(\d+)-(\d+)-(\d+)/);
      found.push({
        col, x0, hy: h.y, serial: h.s, id, part: asm?.[2] ?? '',
        name: text(lines[0]), relation: text(lines[1]),
        house: text(lines[idAt - 1], x0 + 40, x0 + 170).replace(/^\s*:\s*/, '').trim(),
      });
    }
  }
  const top = Math.max(...found.map((c) => c.hy), 0);
  const cards = found.map((c) => ({ ...c, row: Math.round((top - c.hy) / ROW_PITCH) + 1, rowY: 0 }));
  // Cards in one row share a nominal header position, so pictures are cut out consistently.
  for (const c of cards) c.rowY = Math.max(...cards.filter((o) => o.row === c.row).map((o) => o.hy));
  return cards;
}

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
      voters.push({
        name: c.name, relation: c.relation, voterId: c.id, house: c.house, part: c.part, serial: c.serial, station: '',
        page: printed, pdfPage: p, col: c.col + 1, row: c.row, cardY: c.rowY, img: cardPath(listId, p, c.col + 1, c.row),
        nameKey: skeleton(c.name), relKey: skeleton(c.relation),
      });
    }
    page.cleanup();
    onProgress({ page: p, total: pdf.numPages, cards: voters.length });
  }
  await (pdf as any).destroy?.();
  if (!voters.length) throw new Error('UNSUPPORTED_LAYOUT');
  return voters;
}
