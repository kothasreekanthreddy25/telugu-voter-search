import type { Voter } from './types';
import { clean } from './text';

export type FieldKey = 'name' | 'relation' | 'voterId' | 'house' | 'part' | 'serial' | 'station';
export const FIELD_LABELS: Record<FieldKey, string> = {
  name: 'Name (పేరు)', relation: 'Father/Husband name', voterId: 'Voter ID (EPIC)',
  house: 'House number', part: 'Part number', serial: 'Serial number', station: 'Polling station',
};

export interface Table { headers: string[]; rows: string[][] }
export type Mapping = Record<FieldKey, number>; // column index, -1 = not mapped

const SYNONYMS: Record<FieldKey, RegExp> = {
  voterId: /epic|voter\s*id|\bid\b|ఓటరు\s*ఐ|గుర్తింపు/i,
  relation: /father|husband|relat|guardian|తండ్రి|భర్త/i,
  house: /house|door|ఇంటి|ఇల్లు/i,
  part: /part|భాగం|పార్ట్/i,
  serial: /serial|s\.?\s*no|sl\.?\s*no|క్రమ/i,
  station: /station|booth|polling|కేంద్రం|బూత్/i,
  name: /name|పేరు/i,
};

/** Header-based guess; the admin can correct it in the mapping UI. */
export function guessMapping(headers: string[]): Mapping {
  const m = Object.fromEntries((Object.keys(SYNONYMS) as FieldKey[]).map((k) => [k, -1])) as Mapping;
  const used = new Set<number>();
  // Specific fields first so "Father name" is not taken as the voter's own name.
  for (const key of ['voterId', 'relation', 'house', 'part', 'serial', 'station', 'name'] as FieldKey[]) {
    const idx = headers.findIndex((h, i) => !used.has(i) && SYNONYMS[key].test(h));
    if (idx >= 0) { m[key] = idx; used.add(idx); }
  }
  return m;
}

export interface Validation { voters: Voter[]; skipped: number; duplicates: number }

export function toVoters(t: Table, m: Mapping): Validation {
  const get = (r: string[], k: FieldKey) => (m[k] >= 0 ? clean(r[m[k]] ?? '') : '');
  const seen = new Set<string>();
  const voters: Voter[] = [];
  let skipped = 0, duplicates = 0;
  for (const r of t.rows) {
    const v: Voter = {
      name: get(r, 'name'), relation: get(r, 'relation'), voterId: get(r, 'voterId'),
      house: get(r, 'house'), part: get(r, 'part'), serial: get(r, 'serial'), station: get(r, 'station'),
    };
    if (!v.name) { skipped++; continue; }
    const key = v.voterId ? `id:${v.voterId.toUpperCase()}` : `${v.part}|${v.serial}|${v.name}`;
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    voters.push(v);
  }
  return { voters, skipped, duplicates };
}

const isBlank = (r: string[]) => r.every((c) => !clean(c));

export function finish(grid: unknown[][]): Table {
  const rows = grid.map((r) => r.map((c) => String(c ?? ''))).filter((r) => !isBlank(r));
  if (!rows.length) throw new Error('The file has no rows.');
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '');
  const [head, ...rest] = rows.map(pad);
  return { headers: head.map((h, i) => clean(h) || `Column ${i + 1}`), rows: rest };
}

export async function readCsv(file: File): Promise<Table> {
  const Papa = (await import('papaparse')).default;
  const text = (await file.text()).replace(/^﻿/, ''); // decoded as UTF-8 so Telugu survives
  return finish(Papa.parse<string[]>(text, { skipEmptyLines: true }).data);
}

export async function readExcel(file: File): Promise<Table> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return finish(XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' }));
}

export async function readFile(file: File): Promise<Table> {
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'txt') return readCsv(file);
  if (ext === 'xlsx' || ext === 'xls') return readExcel(file);
  throw new Error('Unsupported file type. Use CSV or Excel.');
}
