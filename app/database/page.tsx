'use client';
import { useCallback, useEffect, useState } from 'react';
import { AdminGate } from '@/components/Session';
import { getDb } from '@/lib/db';
import type { VoterList } from '@/lib/types';

export default function DatabasePage() {
  return (
    <main className="space-y-4 p-5">
      <h1 className="text-xl font-bold">Database</h1>
      <AdminGate><Lists /></AdminGate>
    </main>
  );
}

function Lists() {
  const [lists, setLists] = useState<VoterList[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => setLists(await (await getDb()).lists()), []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  async function remove(l: VoterList) {
    if (!confirm(`Delete "${l.name}" (${l.count} records)? This cannot be undone.`)) return;
    try { await (await getDb()).deleteList(l.id); await load(); } catch (e) { setError((e as Error).message); }
  }
  async function wipe() {
    if (!confirm('Delete ALL voter lists from this device? This cannot be undone.')) return;
    try { await (await getDb()).deleteAll(); await load(); } catch (e) { setError((e as Error).message); }
  }

  if (!lists) return <p className="text-slate-500">Loading…</p>;
  const total = lists.reduce((n, l) => n + l.count, 0);
  return (
    <div className="space-y-3">
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <p className="text-sm text-slate-600">{lists.length} list(s) · {total.toLocaleString()} records · stored encrypted on this device</p>
      {!lists.length && <p className="rounded-xl bg-white p-4 text-slate-500">No lists imported yet. Use the Import tab.</p>}
      {lists.map((l) => (
        <div key={l.id} className="flex items-center justify-between gap-3 rounded-xl bg-white p-4 shadow-sm">
          <div className="min-w-0">
            <b className="block truncate">{l.name}</b>
            <span className="text-xs text-slate-500">{l.count.toLocaleString()} records · {new Date(l.importedAt).toLocaleString()}</span>
          </div>
          <button onClick={() => remove(l)} className="rounded-lg border border-red-300 px-3 py-1 text-sm text-red-600">Delete</button>
        </div>
      ))}
      {lists.length > 0 && <button onClick={wipe} className="w-full rounded-xl bg-red-600 py-3 font-semibold text-white">Delete all lists</button>}
    </div>
  );
}
