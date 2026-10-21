import { Capacitor } from '@capacitor/core';
import type { Filters, Voter, VoterDb, VoterList } from './types';
import { normId, normName, normNum } from './text';
import { nameMatch, skeleton, SKELETON_VERSION } from './fuzzy';
import { deleteAllCards, deleteCards } from './cards';
import { deleteAllRolls, deleteRoll } from './store';

const DB_NAME = 'voters';
const BATCH = 500;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, imported_at TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS voters (
  id INTEGER PRIMARY KEY AUTOINCREMENT, list_id INTEGER NOT NULL,
  name TEXT NOT NULL, name_norm TEXT NOT NULL, relation TEXT, relation_norm TEXT,
  voter_id TEXT, house TEXT, part TEXT, serial TEXT, station TEXT,
  name_key TEXT, rel_key TEXT, page TEXT, pdf_page INTEGER, card_col INTEGER, card_row INTEGER, img TEXT, card_y REAL);
CREATE INDEX IF NOT EXISTS idx_voter_id ON voters(voter_id);
CREATE INDEX IF NOT EXISTS idx_part_serial ON voters(part, serial);
CREATE INDEX IF NOT EXISTS idx_list ON voters(list_id);
`;
// Columns added after the first release; older installs get them through ALTER TABLE.
const LATER_COLUMNS: [string, string][] = [
  ['name_key', 'TEXT'], ['rel_key', 'TEXT'], ['page', 'TEXT'], ['pdf_page', 'INTEGER'],
  ['card_col', 'INTEGER'], ['card_row', 'INTEGER'], ['img', 'TEXT'], ['card_y', 'REAL'],
];

const INSERT =
  'INSERT INTO voters (list_id,name,name_norm,relation,relation_norm,voter_id,house,part,serial,station,name_key,rel_key,page,pdf_page,card_col,card_row,img,card_y) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';

/** Exact-match filters only; name and father/husband name are matched approximately in JS. */
export function buildWhere(f: Filters): { sql: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  if (f.voterId) { parts.push('voter_id = ?'); params.push(normId(f.voterId)); }
  if (f.house) { parts.push('LOWER(house) = ?'); params.push(normNum(f.house)); }
  if (f.part) { parts.push('LOWER(part) = ?'); params.push(normNum(f.part)); }
  if (f.serial) { parts.push('LOWER(serial) = ?'); params.push(normNum(f.serial)); }
  return { sql: parts.length ? parts.join(' AND ') : '1', params };
}

const hasAnyFilter = (f: Filters) => Object.values(f).some(Boolean);

type Row = Record<string, string | number | null>;
const toVoter = (r: Row): Voter => ({
  id: Number(r.id), listId: Number(r.list_id), name: String(r.name ?? ''), relation: String(r.relation ?? ''),
  voterId: String(r.voter_id ?? ''), house: String(r.house ?? ''), part: String(r.part ?? ''),
  serial: String(r.serial ?? ''), station: String(r.station ?? ''),
  page: r.page ? String(r.page) : undefined, pdfPage: r.pdf_page ? Number(r.pdf_page) : undefined,
  col: r.card_col ? Number(r.card_col) : undefined, row: r.card_row ? Number(r.card_row) : undefined,
  img: r.img ? String(r.img) : undefined, cardY: r.card_y != null ? Number(r.card_y) : undefined,
});
const insertParams = (listId: number, v: Voter) => [
  listId, v.name, normName(v.name), v.relation, normName(v.relation), normId(v.voterId), v.house, v.part, v.serial, v.station,
  v.nameKey ?? skeleton(v.name), v.relKey ?? skeleton(v.relation), v.page ?? null, v.pdfPage ?? null, v.col ?? null, v.row ?? null, v.img ?? null, v.cardY ?? null,
];

/**
 * Ranks candidates by how closely their name (and father/husband name) match what was said. Voters matching every
 * spoken word come first; partial matches are only used when nobody matches every word.
 */
function rank(cands: { id: number; nameKey: string; relKey: string; order: number }[], f: Filters, limit: number): number[] {
  const scored: { id: number; d: number; missing: number; order: number }[] = [];
  for (const c of cands) {
    let d = 0, missing = 0;
    if (f.name) { const x = nameMatch(c.nameKey, f.name); if (!x) continue; d += x.cost; missing += x.missing; }
    if (f.relation) { const x = nameMatch(c.relKey, f.relation); if (!x) continue; d += x.cost; missing += x.missing; }
    scored.push({ id: c.id, d, missing, order: c.order });
  }
  const best = Math.min(...scored.map((s) => s.missing));
  return scored.filter((s) => s.missing === best).sort((a, b) => a.d - b.d || a.order - b.order).slice(0, limit).map((s) => s.id);
}

/** Encrypted (SQLCipher) SQLite on Android. The key is generated once and held in the Android Keystore by the plugin. */
class NativeDb implements VoterDb {
  private db!: import('@capacitor-community/sqlite').SQLiteDBConnection;

  async init() {
    const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite');
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    if (!(await sqlite.isSecretStored()).result) {
      const key = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
      await sqlite.setEncryptionSecret(key);
    }
    await sqlite.checkConnectionsConsistency();
    const exists = (await sqlite.isConnection(DB_NAME, false)).result;
    this.db = exists
      ? await sqlite.retrieveConnection(DB_NAME, false)
      : await sqlite.createConnection(DB_NAME, true, 'secret', 1, false);
    await this.db.open();
    await this.db.execute(SCHEMA);
    const have = new Set(((await this.db.query('PRAGMA table_info(voters)')).values ?? []).map((c) => c.name));
    for (const [col, type] of LATER_COLUMNS) if (!have.has(col)) await this.db.execute(`ALTER TABLE voters ADD COLUMN ${col} ${type}`);
    await this.rebuildKeys();
  }

  /** Search keys depend on skeleton(); when its rules change, rebuild them from the saved names. */
  private async rebuildKeys() {
    const version = ((await this.db.query('PRAGMA user_version')).values?.[0]?.user_version as number) ?? 0;
    if (version >= SKELETON_VERSION) return;
    const rows = (await this.db.query('SELECT id, name, relation FROM voters')).values ?? [];
    for (let i = 0; i < rows.length; i += BATCH) {
      const set = rows.slice(i, i + BATCH).map((r) => ({ statement: 'UPDATE voters SET name_key = ?, rel_key = ? WHERE id = ?', values: [skeleton(r.name ?? ''), skeleton(r.relation ?? ''), r.id] }));
      await this.db.executeSet(set, true);
    }
    await this.db.execute(`PRAGMA user_version = ${SKELETON_VERSION}`);
  }

  async createList(name: string) {
    const res = await this.db.run('INSERT INTO lists (name, imported_at, count) VALUES (?,?,0)', [name, new Date().toISOString()], false);
    return res.changes!.lastId!;
  }

  async appendVoters(listId: number, rows: Voter[], onProgress?: (n: number) => void) {
    for (let i = 0; i < rows.length; i += BATCH) {
      const set = rows.slice(i, i + BATCH).map((v) => ({ statement: INSERT, values: insertParams(listId, v) }));
      await this.db.executeSet(set, true);
      onProgress?.(Math.min(i + BATCH, rows.length));
    }
    await this.db.run('UPDATE lists SET count = (SELECT COUNT(*) FROM voters WHERE list_id = ?) WHERE id = ?', [listId, listId], false);
  }

  async addList(name: string, rows: Voter[], onProgress?: (n: number) => void) {
    const listId = await this.createList(name);
    try {
      await this.appendVoters(listId, rows, onProgress);
    } catch (e) {
      await this.deleteList(listId);
      throw e;
    }
    return listId;
  }

  async lists(): Promise<VoterList[]> {
    const r = await this.db.query('SELECT id, name, imported_at, count FROM lists ORDER BY id DESC');
    return (r.values ?? []).map((x) => ({ id: x.id, name: x.name, importedAt: x.imported_at, count: x.count }));
  }

  async deleteList(id: number) {
    await this.db.run('DELETE FROM voters WHERE list_id = ?', [id], false);
    await this.db.run('DELETE FROM lists WHERE id = ?', [id], false);
    await this.db.execute('VACUUM');
    await deleteCards(id);
    await deleteRoll(id);
  }

  async deleteAll() {
    await this.db.execute('DELETE FROM voters; DELETE FROM lists; VACUUM;');
    await deleteAllCards();
    await deleteAllRolls();
  }

  async search(f: Filters, limit = 50) {
    if (!hasAnyFilter(f)) return [];
    const w = buildWhere(f);
    if (!f.name && !f.relation) {
      const r = await this.db.query(`SELECT * FROM voters WHERE ${w.sql} ORDER BY id LIMIT ${Math.floor(limit)}`, w.params);
      return (r.values ?? []).map(toVoter);
    }
    const r = await this.db.query(`SELECT id, name_key, rel_key FROM voters WHERE ${w.sql}`, w.params);
    const ids = rank((r.values ?? []).map((x) => ({ id: x.id, nameKey: x.name_key ?? '', relKey: x.rel_key ?? '', order: x.id })), f, limit);
    if (!ids.length) return [];
    const rows = (await this.db.query(`SELECT * FROM voters WHERE id IN (${ids.join(',')})`)).values ?? [];
    const byId = new Map(rows.map((x) => [x.id, x]));
    return ids.map((id) => toVoter(byId.get(id)!));
  }
}

/** Browser-preview fallback for development only. NOT encrypted; the Android build never uses it. */
class WebDb implements VoterDb {
  private KEY = 'voters-web-preview';
  private data: { lists: VoterList[]; voters: (Voter & { listId: number; id: number })[]; seq: number } = { lists: [], voters: [], seq: 0 };
  private nextVoterId = 1;

  async init() {
    try { const s = localStorage.getItem(this.KEY); if (s) this.data = JSON.parse(s); } catch { /* start empty */ }
    this.nextVoterId = Math.max(0, ...this.data.voters.map((v) => v.id)) + 1;
  }
  private save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch { /* quota */ } }

  async createList(name: string) {
    const id = ++this.data.seq;
    this.data.lists.unshift({ id, name, importedAt: new Date().toISOString(), count: 0 });
    return id;
  }
  async appendVoters(listId: number, rows: Voter[], onProgress?: (n: number) => void) {
    rows.forEach((v) => this.data.voters.push({
      ...v, id: this.nextVoterId++, listId, voterId: normId(v.voterId),
      nameKey: v.nameKey ?? skeleton(v.name), relKey: v.relKey ?? skeleton(v.relation),
    }));
    const l = this.data.lists.find((x) => x.id === listId)!;
    l.count = this.data.voters.filter((v) => v.listId === listId).length;
    onProgress?.(rows.length);
    this.save();
  }
  async addList(name: string, rows: Voter[], onProgress?: (n: number) => void) {
    const id = await this.createList(name);
    await this.appendVoters(id, rows, onProgress);
    return id;
  }
  async lists() { return this.data.lists; }
  async deleteList(id: number) {
    this.data.lists = this.data.lists.filter((l) => l.id !== id);
    this.data.voters = this.data.voters.filter((v) => v.listId !== id);
    this.save();
    await deleteCards(id);
    await deleteRoll(id);
  }
  async deleteAll() { this.data.lists = []; this.data.voters = []; this.save(); await deleteAllCards();
    await deleteAllRolls(); }

  async search(f: Filters, limit = 50) {
    if (!hasAnyFilter(f)) return [];
    const exact = this.data.voters.filter((v) =>
      (!f.voterId || v.voterId === normId(f.voterId)) &&
      (!f.house || normNum(v.house) === normNum(f.house)) &&
      (!f.part || normNum(v.part) === normNum(f.part)) &&
      (!f.serial || normNum(v.serial) === normNum(f.serial)));
    if (!f.name && !f.relation) return exact.slice(0, limit);
    const ids = rank(exact.map((v) => ({ id: v.id, nameKey: v.nameKey ?? '', relKey: v.relKey ?? '', order: v.id })), f, limit);
    const byId = new Map(exact.map((v) => [v.id, v]));
    return ids.map((id) => byId.get(id)!);
  }
}

let instance: Promise<VoterDb> | null = null;
export function getDb(): Promise<VoterDb> {
  instance ??= (async () => {
    const db: VoterDb = Capacitor.isNativePlatform() ? new NativeDb() : new WebDb();
    await db.init();
    return db;
  })();
  return instance;
}
