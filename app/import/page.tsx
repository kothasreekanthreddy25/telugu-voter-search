'use client';
import { useMemo, useState } from 'react';
import { AdminGate } from '@/components/Session';
import { FIELD_LABELS, guessMapping, readFile, toVoters, type FieldKey, type Mapping, type Table } from '@/lib/import';
import { getDb } from '@/lib/db';

export default function ImportPage() {
  return (
    <main className="space-y-4 p-5">
      <h1 className="text-xl font-bold">Import voter list</h1>
      <AdminGate><Importer /></AdminGate>
    </main>
  );
}

function Importer() {
  const [file, setFile] = useState<File | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [listName, setListName] = useState('');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  const validation = useMemo(() => (table && mapping ? toVoters(table, mapping) : null), [table, mapping]);

  async function pick(f: File | undefined) {
    if (!f) return;
    setError(''); setDone(''); setTable(null); setFile(f); setBusy(true); setProgress('Reading file…');
    try {
      const t = await readFile(f, (p, n) => setProgress(`Reading PDF page ${p} of ${n}…`));
      setTable(t);
      setMapping(guessMapping(t.headers));
      setListName(f.name.replace(/\.[^.]+$/, ''));
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false); setProgress('');
  }

  async function run() {
    if (!validation) return;
    setBusy(true); setError('');
    try {
      const db = await getDb();
      const total = validation.voters.length;
      await db.addList(listName || file!.name, validation.voters, (n) => setProgress(`Saving ${n} / ${total}…`));
      setDone(`Imported ${total} records.`);
      setTable(null);
    } catch (e) {
      setError(`Import failed and was rolled back: ${(e as Error).message}`);
    }
    setBusy(false); setProgress('');
  }

  const set = (k: FieldKey, v: number) => setMapping((m) => ({ ...m!, [k]: v }));

  return (
    <div className="space-y-4">
      <label className="block rounded-2xl border-2 border-dashed border-slate-300 bg-white p-6 text-center">
        <span className="font-medium">Choose CSV, Excel or text-based PDF</span>
        <input type="file" className="mt-3 block w-full text-sm"
          accept=".csv,.txt,.xlsx,.xls,.pdf,text/csv,text/plain,text/comma-separated-values,application/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; pick(f); }} />
      </label>
      {file && <p className="rounded-xl bg-white p-3 text-sm">Selected: <b>{file.name}</b> ({Math.round(file.size / 1024)} KB)</p>}
      {progress &&<p className="text-sm text-slate-600" aria-live="polite">{progress}</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {done && <p className="rounded-xl bg-green-50 p-3 text-sm text-green-800">{done}</p>}

      {table && mapping && validation && (
        <>
          <input value={listName} onChange={(e) => setListName(e.target.value)} className="w-full rounded-xl border px-3 py-2" placeholder="List name" />
          <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="font-semibold">Map columns</h2>
            {(Object.keys(FIELD_LABELS) as FieldKey[]).map((k) => (
              <label key={k} className="flex items-center justify-between gap-3 text-sm">
                <span>{FIELD_LABELS[k]}{k === 'name' && ' *'}</span>
                <select value={mapping[k]} onChange={(e) => set(k, Number(e.target.value))} className="max-w-[55%] rounded-lg border px-2 py-1">
                  <option value={-1}>— not in file —</option>
                  {table.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </label>
            ))}
          </section>

          <section className="overflow-x-auto rounded-2xl bg-white p-3 shadow-sm">
            <h2 className="mb-2 font-semibold">Preview (first 5 of {table.rows.length} rows)</h2>
            <table className="w-full text-left text-xs">
              <thead><tr>{table.headers.map((h, i) => <th key={i} className="whitespace-nowrap px-2 py-1">{h}</th>)}</tr></thead>
              <tbody>{table.rows.slice(0, 5).map((r, i) => <tr key={i} className="border-t">{r.map((c, j) => <td key={j} className="whitespace-nowrap px-2 py-1">{c}</td>)}</tr>)}</tbody>
            </table>
          </section>

          <p className="text-sm text-slate-700">
            Valid records: <b>{validation.voters.length}</b> · skipped (no name): {validation.skipped} · duplicates removed: {validation.duplicates}
          </p>
          <button disabled={busy || mapping.name < 0 || !validation.voters.length} onClick={run}
            className="w-full rounded-xl bg-indigo-600 py-3 font-semibold text-white disabled:opacity-40">
            Import {validation.voters.length} records
          </button>
          {mapping.name < 0 && <p className="text-sm text-red-600">Map the Name column to continue.</p>}
        </>
      )}
    </div>
  );
}
