import type { SearchField } from './types';
import { clean, normId } from './text';

export interface Command { field: SearchField; value: string }

// Order matters: the first keyword found wins, so more specific phrases come first.
const KEYWORDS: [SearchField, string[]][] = [
  ['voterId', ['ఓటరు ఐడి', 'ఓటర్ ఐడి', 'ఓటరు ఐడీ', 'ఓటర్ ఐడీ', 'ఎపిక్', 'voter id', 'epic', 'ఐడి', 'ఐడీ', ' id']],
  ['house', ['ఇంటి నంబర్', 'ఇంటి నెంబర్', 'ఇంటి నంబరు', 'ఇంటి సంఖ్య', 'డోర్ నంబర్', 'house number', 'house no', 'house', 'ఇంటి']],
  ['serial', ['క్రమ సంఖ్య', 'క్రమసంఖ్య', 'సీరియల్ నంబర్', 'సీరియల్', 'serial number', 'serial']],
  ['part', ['పార్ట్ నంబర్', 'పార్ట్ నెంబర్', 'పార్ట్', 'భాగం సంఖ్య', 'భాగం', 'part number', 'part']],
  ['relation', ['తండ్రి పేరు', 'భర్త పేరు', 'తండ్రి', 'భర్త', 'father name', 'husband name', 'father', 'husband']],
  ['name', ['పేరు', 'name']],
];

const FILLERS = [
  'నంబర్', 'నెంబర్', 'నంబరు', 'సంఖ్య', 'శోధించు', 'వెతుకు', 'వెతకండి', 'కోసం', 'చెప్పు', 'చెప్పండి',
  'search', 'find', 'for', 'number', 'is', 'ఏమిటి', 'ఏంటి',
];

function stripFillers(s: string): string {
  let out = ` ${s} `;
  for (const f of FILLERS) out = out.split(` ${f} `).join(' ').split(` ${f} `).join(' ');
  return out.trim();
}

/** Deterministic command parser: finds a field keyword and treats the rest as the value. */
export function parseCommand(raw: string): Command | null {
  const text = clean(raw).toLowerCase();
  if (!text) return null;
  const padded = ` ${text}`;

  for (const [field, words] of KEYWORDS) {
    for (const w of words) {
      const idx = padded.indexOf(w);
      if (idx < 0) continue;
      const before = padded.slice(0, idx);
      const after = padded.slice(idx + w.length);
      // "<value> పేరు" and "పేరు <value>" are both natural in Telugu.
      let value = stripFillers((after.trim() || before.trim()).trim());
      if (!value) continue;
      if (field === 'voterId') value = normId(value);
      // Voter IDs always contain letters, so "id 823" can only mean the serial number printed on the card.
      if (field === 'voterId' && /^\d{1,5}$/.test(value)) return { field: 'serial', value };
      return { field, value };
    }
  }
  // No keyword: a bare token that looks like a voter ID, else treat as a name.
  const bare = stripFillers(text);
  if (!bare) return null;
  if (/^[a-z]{2,4}\s?\d{5,}$/i.test(bare)) return { field: 'voterId', value: normId(bare) };
  // A number on its own is a serial number.
  if (/^\d{1,5}$/.test(bare)) return { field: 'serial', value: bare };
  return { field: 'name', value: bare };
}
