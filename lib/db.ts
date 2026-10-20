import { Capacitor } from '@capacitor/core';
import type { Filters, Voter, VoterDb, VoterList } from './types';
import { normId, normName, normNum } from './text';

const DB_NAME = 'voters';
const BATCH = 500;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, imported_at TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS voters (
  id INTEGER PRIMARY KEY AUTOINCREMENT, list_id INTEGER NOT NULL,
  name TEXT NOT NULL, name_norm TEXT NOT NULL, relation TEXT, relation_norm TEXT,
  voter_id TEXT, house TEXT, part TEXT, serial TEXT, station TEXT);
CREATE INDEX IF NOT EXISTS idx_voter_id ON voters(voter_id);
CREATE INDEX IF NOT EXISTS idx_name ON voters(name_norm);
CREATE INDEX IF NOT EXISTS idx_part_serial ON voters(part, serial);
CREATE INDEX IF NOT EXISTS idx_list ON voters(list_id);
`;

const INSERT =
  'INSERT INTO voters (list_id,name,name_norm,relation,relation_norm,voter_id,house,part,serial,station) VALUES (?,?,?,?,?,?,?,?,?,?)';

const likeEsc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Builds the WHERE clause so native SQLite and the web fallback share one definition. */
export function buildWhere(f: Filters): { sql: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  if (f.voterId) { parts.push('voter_id = ?'); params.push(normId(f.voterId)); }
  if (f.house) { parts.push('LOWER(house) = ?'); params.push(normNum(f.house)); }
  if (f.part) { parts.push('LOWER(part) = ?'); params.push(normNum(f.part)); }
  if (f.serial) { parts.push('LOWER(serial) = ?'); params.push(normNum(f.serial)); }
  for (const [key, col] of [['name', 'name_norm'], ['relation', 'relation_norm']] as const) {
    const v = f[key];
    if (!v) continue;
    for (const tok of normName(v).split(' ').filter(Boolean)) {
      parts.push(`${col} LIKE ? ESCAPE '\\'`);
      params.push(`%${likeEsc(tok)}%`);
    }
  }
  return { sql: parts.length ? parts.join(' AND ') : '0', params };
}

type Row = Record<string, string | number | null>;
const toVoter = (r: Row): Voter => ({
  id: Number(r.id), listId: Number(r.list_id), name: String(r.name ?? ''), relation: String(r.relation ?? ''),
  voterId: String(r.voter_id ?? ''), house: String(r.house ?? ''), part: String(r.part ?? ''),
  serial: String(r.serial ?? ''), station: String(r.station ?? ''),
});
const insertParams = (listId: number, v: Voter) => [
  listId, v.name, normName(v.name), v.relation, normName(v.relation), normId(v.voterId), v.house, v.part, v.serial, v.station,
];

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
  }

  async addList(name: string, rows: Voter[], onProgress?: (n: number) => void) {
    const res = await this.db.run('INSERT INTO lists (name, imported_at, count) VALUES (?,?,0)', [name, new Date().toISOString()], false);
    const listId = res.changes!.lastId!;
    try {
      for (let i = 0; i < rows.length; i += BATCH) {
        const set = rows.slice(i, i + BATCH).map((v) => ({ statement: INSERT, values: insertParams(listId, v) }));
        await this.db.executeSet(set, true);
        onProgress?.(Math.min(i + BATCH, rows.length));
      }
      await this.db.run('UPDATE lists SET count = ? WHERE id = ?', [rows.length, listId], false);
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
  }

  async deleteAll() {
    await this.db.execute('DELETE FROM voters; DELETE FROM lists; VACUUM;');
  }

  async search(f: Filters, limit = 50) {
    const w = buildWhere(f);
    const r = await this.db.query(`SELECT * FROM voters WHERE ${w.sql} ORDER BY name_norm LIMIT ${Math.floor(limit)}`, w.params);
    return (r.values ?? []).map(toVoter);
  }
}

/** Browser-preview fallback for development only. NOT encrypted; the Android build never uses it. */
class WebDb implements VoterDb {
  private KEY = 'voters-web-preview';
  private data: { lists: VoterList[]; voters: (Voter & { listId: number })[]; seq: number } = { lists: [], voters: [], seq: 0 };

  async init() {
    try { const s = localStorage.getItem(this.KEY); if (s) this.data = JSON.parse(s); } catch { /* start empty */ }
  }
  private save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch { /* quota */ } }

  async addList(name: string, rows: Voter[], onProgress?: (n: number) => void) {
    const id = ++this.data.seq;
    this.data.lists.unshift({ id, name, importedAt: new Date().toISOString(), count: rows.length });
    rows.forEach((v) => this.data.voters.push({ ...v, listId: id, voterId: normId(v.voterId) }));
    onProgress?.(rows.length);
    this.save();
    return id;
  }
  async lists() { return this.data.lists; }
  async deleteList(id: number) {
    this.data.lists = this.data.lists.filter((l) => l.id !== id);
    this.data.voters = this.data.voters.filter((v) => v.listId !== id);
    this.save();
  }
  async deleteAll() { this.data.lists = []; this.data.voters = []; this.save(); }

  async search(f: Filters, limit = 50) {
    const toks = (s?: string) => (s ? normName(s).split(' ').filter(Boolean) : []);
    const nameT = toks(f.name), relT = toks(f.relation);
    if (!Object.values(f).some(Boolean)) return [];
    const out = this.data.voters.filter((v) => {
      if (f.voterId && v.voterId !== normId(f.voterId)) return false;
      if (f.house && normNum(v.house) !== normNum(f.house)) return false;
      if (f.part && normNum(v.part) !== normNum(f.part)) return false;
      if (f.serial && normNum(v.serial) !== normNum(f.serial)) return false;
      const n = normName(v.name), r = normName(v.relation);
      return nameT.every((t) => n.includes(t)) && relT.every((t) => r.includes(t));
    });
    return out.sort((a, b) => normName(a.name).localeCompare(normName(b.name))).slice(0, limit);
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
