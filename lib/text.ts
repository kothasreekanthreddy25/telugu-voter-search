const TELUGU_DIGITS = '౦౧౨౩౪౫౬౭౮౯';

/** Telugu digits -> ASCII, drop zero-width joiners, NFC, collapse whitespace. */
export function clean(s: string): string {
  return String(s ?? '')
    .replace(/[౦-౯]/g, (d) => String(TELUGU_DIGITS.indexOf(d)))
    .replace(/[​-‍﻿]/g, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
}

export const normName = (s: string) => clean(s).toLowerCase();
export const normId = (s: string) => clean(s).replace(/[\s-]/g, '').toUpperCase();
export const normNum = (s: string) => clean(s).replace(/\s/g, '').replace(/^0+(?=\d)/, '').toLowerCase();

const WORD_NUMBERS: Record<string, number> = {
  ఒకటి: 1, రెండు: 2, మూడు: 3, నాలుగు: 4, ఐదు: 5, ఆరు: 6, ఏడు: 7, ఎనిమిది: 8, తొమ్మిది: 9, పది: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** "3", "౩", "మూడు" -> 3; otherwise null. */
export function parseChoice(s: string): number | null {
  const t = clean(s).toLowerCase().replace(/[.\s]/g, '');
  if (/^\d{1,2}$/.test(t)) return Number(t);
  return WORD_NUMBERS[t] ?? null;
}
