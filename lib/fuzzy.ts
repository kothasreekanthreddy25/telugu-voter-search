import { clean } from './text';

/** Bump when skeleton() changes: stored search keys are rebuilt from the saved names on next start. */
export const SKELETON_VERSION = 5;

// Letters that speech recognition and OCR commonly confuse are folded together.
const FOLD: Record<string, string> = {
  శ: 'స', ష: 'స', ణ: 'న', ళ: 'ల', ఱ: 'ర', ఙ: 'న', ఞ: 'న', 'ం': 'న',
  ఖ: 'క', ఘ: 'గ', ఛ: 'చ', ఝ: 'జ', ఠ: 'త', ట: 'త', థ: 'త', డ: 'ద', ఢ: 'ద', ధ: 'ద', ఫ: 'ప', భ: 'బ',
};

// Vowels are kept as the lowercase markers a e i o u (long/short folded). They count for little, because the PDF's
// Telugu and English spellings disagree about them, but enough to tell "మురళి" from "కుమారి ఆలూరి".
const VOWEL_SIGNS: Record<string, string> = {
  'ా': 'a', 'ి': 'i', 'ీ': 'i', 'ు': 'u', 'ూ': 'u', 'ృ': 'u', 'ె': 'e', 'ే': 'e', 'ై': 'e', 'ొ': 'o', 'ో': 'o', 'ౌ': 'o',
  'అ': 'a', 'ఆ': 'a', 'ఇ': 'i', 'ఈ': 'i', 'ఉ': 'u', 'ఊ': 'u', 'ఋ': 'u', 'ఎ': 'e', 'ఏ': 'e', 'ఐ': 'e', 'ఒ': 'o', 'ఓ': 'o', 'ఔ': 'o',
};

// English spellings are mapped onto the same skeleton, so "balaraju" meets బాలరాజు.
const LATIN_DIGRAPH: Record<string, string> = { sh: 'స', ch: 'చ', th: 'త', dh: 'ద', kh: 'క', gh: 'గ', bh: 'బ', ph: 'ప', jh: 'జ' };
const LATIN: Record<string, string> = {
  k: 'క', c: 'క', q: 'క', g: 'గ', j: 'జ', z: 'జ', t: 'త', d: 'ద', n: 'న', p: 'ప', f: 'ప', b: 'బ', m: 'మ',
  y: 'య', r: 'ర', l: 'ల', v: 'వ', w: 'వ', s: 'స', h: 'హ', x: 'క',
  a: 'a', e: 'e', i: 'i', o: 'o', u: 'u',
};

const isVowel = (c: string) => c.length === 1 && 'aeiou'.includes(c);

/**
 * Shape of a name that survives corrupted PDF text and imperfect speech recognition: consonants in a folded
 * alphabet, vowels as a e i o u, and nothing else (virama, unreadable characters and spaces are dropped).
 */
export function skeleton(s: string, finalYIsVowel = false): string {
  let out = '';
  // A repeated letter counts once: "reddy" / "రెడ్డి" / an OCR reading "redi" must meet (doubled consonants are
  // written inconsistently between scripts, and long vowels were already folded to short ones).
  const push = (c: string) => { if (!out.endsWith(c)) out += c; };
  const text = clean(s).toLowerCase();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/[a-z]/.test(ch)) {
      const two = LATIN_DIGRAPH[text.slice(i, i + 2)];
      if (two) { push(two); i++; }
      // A "y" closing a word after a letter is the vowel i ("reddy", "uday" read as "ి"), not the consonant య.
      else if (finalYIsVowel && ch === 'y' && i > 0 && /[a-z]/.test(text[i - 1]) && !/[a-z]/.test(text[i + 1] ?? ' ')) push('i');
      else push(LATIN[ch]);
      continue;
    }
    if (/[0-9|]/.test(ch)) { out += ch; continue; } // '|' separates independent readings of one name
    const c = ch.codePointAt(0)!;
    if (VOWEL_SIGNS[ch]) { push(VOWEL_SIGNS[ch]); continue; }
    // Telugu consonants and the anusvara; virama, visarga, candrabindu and unreadable characters are dropped.
    if (c >= 0x0c02 && c <= 0x0c7f && c !== 0x0c03 && !(c >= 0x0c3e && c <= 0x0c56) && c !== 0x0c62 && c !== 0x0c63) push(FOLD[ch] ?? ch);
  }
  // A nasal before p/b is spelled "m" in English and with an anusvara in Telugu: ignore it on both sides.
  return out.replace(/[నమ](?=[పబ])/g, '');
}

/** How many consonants a skeleton has; fewer than two is too little to search on. */
export const strength = (sk: string) => [...sk].filter((c) => !isVowel(c) && !/[0-9|]/.test(c)).length;

const VOWEL_COST = 0.35;
const cost = (c: string) => (isVowel(c) ? VOWEL_COST : 1);
const sub = (a: string, b: string) => (a === b ? 0 : isVowel(a) && isVowel(b) ? VOWEL_COST : 1);

/**
 * Cheapest way to find q inside t (Sellers): consonant mistakes cost 1, vowel mistakes 0.35.
 * Infinity when the cost is above what a name of this length may have wrong.
 */
export function approxContains(t: string, q: string): number {
  if (!q) return Infinity;
  const consonants = strength(q), vowels = q.length - consonants;
  // Short queries are ambiguous (a few consonants fit many names), so they get little vowel slack; long ones get more,
  // because English spellings write the short "a" that Telugu leaves out.
  const vowelSlack = consonants <= 1 ? 0 : consonants <= 3 ? Math.max(1, Math.floor(vowels * 0.5)) : Math.ceil(vowels * 0.7);
  const allowed = Math.floor(consonants * 0.3) + VOWEL_COST * vowelSlack + 1e-9;
  let prev: number[] = [0];
  for (let i = 1; i <= q.length; i++) prev[i] = prev[i - 1] + cost(q[i - 1]);
  let best = prev[q.length];
  for (let j = 1; j <= t.length; j++) {
    const cur = [0];
    for (let i = 1; i <= q.length; i++) {
      cur[i] = Math.min(prev[i] + cost(t[j - 1]), cur[i - 1] + cost(q[i - 1]), prev[i - 1] + sub(q[i - 1], t[j - 1]));
    }
    if (cur[q.length] < best) best = cur[q.length];
    prev = cur;
  }
  return best <= allowed ? Math.round(best * 100) / 100 : Infinity;
}

/**
 * How well a stored name matches what was said. At least half of the spoken words must be found: the PDF's Telugu
 * text is partly corrupted, so one damaged word must not hide the voter. The count of missing words lets callers
 * prefer cards that match every word.
 */
export function nameMatch(storedSkeleton: string, query: string): { cost: number; missing: number } | null {
  // A typed word ending in "y" may mean the vowel i ("reddy" = రెడ్డి) or the consonant య ("uday" = ఉదయ్): try both.
  const words = clean(query).split(' ').map((w) => {
    const a = skeleton(w);
    const b = /[a-z]y$/i.test(w) ? skeleton(w, true) : a;
    // The vowel reading only counts when it still has two consonants; with one it would fit far too many names.
    return a ? (b !== a && strength(b) >= 2 ? [a, b] : [a]) : [];
  }).filter((v) => v.length);
  if (!words.length) return null;
  let cost = 0, missing = 0;
  for (const variants of words) {
    const d = Math.min(...variants.map((w) => approxContains(storedSkeleton, w)));
    if (d === Infinity) missing++;
    else cost += d;
  }
  return words.length - missing >= Math.ceil(words.length / 2) ? { cost, missing } : null;
}

/** Single number for tests and sorting: 0 = perfect, Infinity = no match; each missing word costs 4. */
export function nameDistance(storedSkeleton: string, query: string): number {
  const m = nameMatch(storedSkeleton, query);
  return m ? m.cost + 4 * m.missing : Infinity;
}

// One typical English letter per folded Telugu consonant, chosen so that skeleton(romanize(x)) === skeleton(x).
const ROMAN: Record<string, string> = {
  క: 'k', గ: 'g', చ: 'ch', జ: 'j', త: 't', ద: 'd', న: 'n', ప: 'p', బ: 'b', మ: 'm', య: 'y', ర: 'r', ల: 'l', వ: 'v', స: 's', హ: 'h',
};

/**
 * Telugu text as plain English letters. Used to store names read by OCR inside a PDF as invisible ASCII text,
 * which needs no embedded Telugu font and is read back through skeleton().
 */
export function romanize(s: string): string {
  let out = '';
  for (const ch of clean(s).toLowerCase()) {
    if (/[a-z0-9 ]/.test(ch)) { out += ch; continue; }
    if (VOWEL_SIGNS[ch]) { out += VOWEL_SIGNS[ch]; continue; }
    const c = ch.codePointAt(0)!;
    if (c >= 0x0c15 && c <= 0x0c39 || ch === 'ం') out += ROMAN[FOLD[ch] ?? ch] ?? '';
  }
  return out.replace(/\s+/g, ' ').trim();
}
