'use client';
import { useMemo, useRef, useState } from 'react';
import { indexRoll, type IndexProgress } from '@/lib/rollindex';
import { FIELD_LABELS, guessMapping, readFile, toVoters, type FieldKey, type Mapping, type Table } from '@/lib/import';
import { getDb } from '@/lib/db';

export default function ImportPage() {
  return (
    <main className="space-y-5 p-5">
      <h1 className="text-xl font-bold">ఓటర్ల జాబితా · Add voter list</h1>
      <PdfImporter />
      <details className="rounded-2xl bg-white p-4 shadow-sm">
        <summary className="cursor-pointer font-medium text-slate-700">Other formats (Excel / CSV)</summary>
        <div className="mt-4"><SheetImporter /></div>
      </details>
    </main>
  );
}

function PdfImporter() {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [prog, setProg] = useState<IndexProgress | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const cancel = useRef(false);

  async function start(f: File | undefined) {
    if (!f) return;
    setFile(f); setError(''); setDone(''); setProg(null); setBusy(true); cancel.current = false;
    let lock: { release: () => Promise<void> } | null = null;
    try { lock = await (navigator as any).wakeLock?.request('screen'); } catch { /* optional */ }
    const db = await getDb();
    const listId = await db.createList(f.name.replace(/\.pdf$/i, ''));
    try {
      const voters = await indexRoll(f, listId, setProg, () => cancel.current);
      await db.appendVoters(listId, voters);
      setDone(`${voters.length} ఓటర్లు చేర్చబడ్డారు · ${voters.length} voters added. Go to Search.`);
    } catch (e) {
      await db.deleteList(listId);
      const m = (e as Error).message;
      setError(m === 'UNSUPPORTED_LAYOUT'
        ? 'This PDF does not look like a voter-card list, so it could not be read. Try an Excel/CSV file below.'
        : m === 'Cancelled' ? 'Cancelled.' : `Could not read this PDF: ${m}`);
    }
    await lock?.release().catch(() => {});
    setBusy(false);
  }

  return (
    <section className="space-y-4 rounded-2xl bg-white p-5 text-center shadow-sm">
      <label className={`block rounded-2xl bg-indigo-600 px-4 py-5 text-lg font-semibold text-white ${busy ? 'opacity-50' : 'active:scale-95'}`}>
        📄 PDF ఫైల్ ఎంచుకోండి<br /><span className="text-sm font-normal">Choose voter list PDF</span>
        <input type="file" className="hidden" disabled={busy}
          accept=".pdf,application/pdf"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; start(f); }} />
      </label>
      {file && <p className="text-sm text-slate-600">Selected: <b>{file.name}</b> ({(file.size / 1048576).toFixed(1)} MB)</p>}
      {busy && (
        <div className="space-y-2" aria-live="polite">
          <div className="h-3 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-indigo-600 transition-all" style={{ width: `${prog ? (prog.page / prog.total) * 100 : 3}%` }} />
          </div>
          <p className="text-sm">{prog ? `పేజీ ${prog.page} / ${prog.total} · ${prog.cards} voters` : 'Opening file…'}</p>
          <p className="text-xs text-slate-500">This happens once. Keep the screen on and do not close the app.</p>
          <button onClick={() => { cancel.current = true; }} className="text-sm text-red-600 underline">Cancel</button>
        </div>
      )}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {done && <p className="rounded-xl bg-green-50 p-3 text-sm text-green-800">{done}</p>}
    </section>
  );
}
function SheetImporter() {
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
      const t = await readFile(f);
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
        <span className="font-medium">Choose a CSV or Excel file</span>
        <input type="file" className="mt-3 block w-full text-sm"
          accept=".csv,.txt,.xlsx,.xls,text/csv,text/plain,text/comma-separated-values,application/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream"
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
