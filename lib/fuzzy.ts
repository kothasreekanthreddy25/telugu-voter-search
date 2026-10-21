import { clean } from './text';

/** Bump when skeleton() changes: stored search keys are rebuilt from the saved names on next start. */
export const SKELETON_VERSION = 2;

// Letters that speech recognition and OCR commonly confuse are folded together.
const FOLD: Record<string, string> = {
  శ: 'స', ష: 'స', ణ: 'న', ళ: 'ల', ఱ: 'ర', ఙ: 'న', ఞ: 'న',
  ఖ: 'క', ఘ: 'గ', ఛ: 'చ', ఝ: 'జ', ఠ: 'త', ట: 'త', థ: 'త', డ: 'ద', ఢ: 'ద', ధ: 'ద', ఫ: 'ప', భ: 'బ',
};

// English spellings are mapped onto the same consonant skeleton, so "balaraju" meets బాలరాజు.
const LATIN_DIGRAPH: Record<string, string> = { sh: 'స', ch: 'చ', th: 'త', dh: 'ద', kh: 'క', gh: 'గ', bh: 'బ', ph: 'ప', jh: 'జ', ng: 'న' };
const LATIN: Record<string, string> = {
  k: 'క', c: 'క', q: 'క', g: 'గ', j: 'జ', z: 'జ', t: 'త', d: 'ద', n: 'న', p: 'ప', f: 'ప', b: 'బ', m: 'మ',
  y: 'య', r: 'ర', l: 'ల', v: 'వ', w: 'వ', s: 'స', h: 'హ', x: 'క',
};

/**
 * Shape of a name that survives corrupted PDF text and imperfect speech recognition:
 * vowel signs, virama, anusvara and unreadable characters are dropped, look-alike letters are folded.
 */
export function skeleton(s: string): string {
  let out = '';
  const text = clean(s).toLowerCase();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/[a-z]/.test(ch)) {
      const two = LATIN_DIGRAPH[text.slice(i, i + 2)];
      if (two) { out += two; i++; } else out += LATIN[ch] ?? ''; // vowels carry no weight
      continue;
    }
    const c = ch.codePointAt(0)!;
    if (ch === '\u0000' || ch === ' ') continue;
    if ((c >= 0x0c05 && c <= 0x0c14) || c === 0x0c60 || c === 0x0c61) continue; // independent vowels: English vowels carry no weight either
    if ((c >= 0x0c00 && c <= 0x0c04) || (c >= 0x0c3e && c <= 0x0c4d) || c === 0x0c55 || c === 0x0c56 || c === 0x0c62 || c === 0x0c63) continue;
    if (c >= 0x0c00 && c <= 0x0c7f) out += FOLD[ch] ?? ch;
    else if (/[0-9]/.test(ch)) out += ch;
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

/**
 * How well a stored name matches what was said (0 = perfect, Infinity = no match). At least half of the spoken
 * words must be found: the PDF's Telugu text is partly corrupted, so one damaged word must not hide the voter.
 * Words that are not found cost extra, so cards that match every word rank first.
 */
export function nameDistance(storedSkeleton: string, query: string): number {
  const words = clean(query).split(' ').map(skeleton).filter(Boolean);
  if (!words.length) return Infinity;
  let total = 0, found = 0;
  for (const w of words) {
    const d = approxContains(storedSkeleton, w);
    if (d === Infinity) total += 4;
    else { total += d; found++; }
  }
  return found >= Math.ceil(words.length / 2) ? total : Infinity;
}
