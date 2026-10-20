import { clean } from './text';

// Letters that speech recognition and OCR commonly confuse are folded together.
const FOLD: Record<string, string> = {
  ఆ: 'అ', ఈ: 'ఇ', ఊ: 'ఉ', ఏ: 'ఎ', ఓ: 'ఒ', ౠ: 'ఋ',
  శ: 'స', ష: 'స', ణ: 'న', ళ: 'ల', ఱ: 'ర', ఙ: 'న', ఞ: 'న',
  ఖ: 'క', ఘ: 'గ', ఛ: 'చ', ఝ: 'జ', ఠ: 'ట', ఢ: 'డ', థ: 'త', ధ: 'ద', ఫ: 'ప', భ: 'బ',
};

/**
 * Shape of a name that survives corrupted PDF text and imperfect speech recognition:
 * vowel signs, virama, anusvara and unreadable characters are dropped, look-alike letters are folded.
 */
export function skeleton(s: string): string {
  let out = '';
  for (const ch of clean(s).toLowerCase()) {
    const c = ch.codePointAt(0)!;
    if (ch === '\u0000' || ch === ' ') continue;
    if ((c >= 0x0c00 && c <= 0x0c04) || (c >= 0x0c3e && c <= 0x0c4d) || c === 0x0c55 || c === 0x0c56 || c === 0x0c62 || c === 0x0c63) continue;
    if (c >= 0x0c00 && c <= 0x0c7f) out += FOLD[ch] ?? ch;
    else if (/[a-z0-9]/.test(ch)) out += ch;
  }
  return out;
}

/** Smallest edit distance between q and any substring of t (Sellers). Infinity if above the allowance. */
export function approxContains(t: string, q: string): number {
  if (!q) return Infinity;
  const allowed = q.length <= 2 ? 0 : Math.floor(q.length * 0.3);
  let prev = Array.from({ length: q.length + 1 }, (_, i) => i);
  let best = prev[q.length];
  for (let j = 1; j <= t.length; j++) {
    const cur = [0];
    for (let i = 1; i <= q.length; i++) {
      cur[i] = Math.min(prev[i] + 1, cur[i - 1] + 1, prev[i - 1] + (q[i - 1] === t[j - 1] ? 0 : 1));
    }
    if (cur[q.length] < best) best = cur[q.length];
    prev = cur;
  }
  return best <= allowed ? best : Infinity;
}

/** Every spoken word must be found somewhere in the stored name; the score is the total edit distance. */
export function nameDistance(storedSkeleton: string, query: string): number {
  const words = clean(query).split(' ').map(skeleton).filter(Boolean);
  if (!words.length) return Infinity;
  let total = 0;
  for (const w of words) {
    const d = approxContains(storedSkeleton, w);
    if (d === Infinity) return Infinity;
    total += d;
  }
  return total;
}
