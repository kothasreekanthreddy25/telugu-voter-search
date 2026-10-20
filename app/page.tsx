'use client';
import { useEffect, useRef, useState } from 'react';
import { getSnippet } from '@/lib/snippet';
import { getDb } from '@/lib/db';
import { parseCommand } from '@/lib/command';
import { parseChoice } from '@/lib/text';
import { describeVoter, listen, phrases, speak, stopListening, stopSpeaking } from '@/lib/voice';
import type { Filters, Voter } from '@/lib/types';

type Status = 'idle' | 'listening' | 'searching';
const FIELD_NAMES: Record<string, string> = {
  name: 'పేరు', relation: 'తండ్రి/భర్త', voterId: 'ఓటరు ఐడి', house: 'ఇంటి నంబర్', part: 'పార్ట్', serial: 'క్రమ సంఖ్య',
};

export default function Home() {
  const [status, setStatus] = useState<Status>('idle');
  const [heard, setHeard] = useState('');
  const [message, setMessage] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [results, setResults] = useState<Voter[]>([]);
  const [selected, setSelected] = useState<Voter | null>(null);
  const [typed, setTyped] = useState('');
  const [showAll, setShowAll] = useState(false);
  const busy = useRef(false);

  const say = async (text: string) => { setMessage(text); await speak(text).catch(() => {}); };

  async function showVoter(v: Voter) {
    setSelected(v);
    await say(describeVoter(v));
  }

  async function handle(text: string) {
    setHeard(text);
    setStatus('searching');
    try {
      const db = await getDb();
      if (!(await db.lists()).length) return await say(phrases.noData);

      // Picking one of several listed voters, by number: an explicit user choice, never automatic.
      const choice = parseChoice(text);
      if (results.length > 1 && choice && choice <= results.length) return await showVoter(results[choice - 1]);

      const cmd = parseCommand(text);
      if (!cmd) return await say(phrases.notUnderstood);

      // A different field than before narrows the current search; the same field starts over.
      const refining = results.length > 1 && !(cmd.field in filters);
      const next: Filters = refining ? { ...filters, [cmd.field]: cmd.value } : { [cmd.field]: cmd.value };
      const found = await db.search(next);

      if (!found.length) {
        await say(phrases.notFound);
        return;
      }
      setFilters(next);
      setShowAll(false);
      setResults(found);
      setSelected(null);
      if (found.length === 1) await showVoter(found[0]);
      else await say(found.length > 5 ? phrases.tooMany(found.length) : phrases.few(found.length));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setStatus('idle');
    }
  }

  async function onMic() {
    if (busy.current) { await stopListening(); return; }
    busy.current = true;
    await stopSpeaking();
    setMessage('');
    try {
      setStatus('listening');
      await handle(await listen());
    } catch (e) {
      setStatus('idle');
      setMessage((e as Error).message);
      await speak(phrases.notUnderstood).catch(() => {});
    } finally {
      busy.current = false;
    }
  }

  function reset() {
    stopSpeaking();
    setFilters({}); setResults([]); setSelected(null); setHeard(''); setMessage('');
  }

  const active = Object.entries(filters);

  return (
    <main className="space-y-5 p-5">
      <h1 className="text-xl font-bold">ఓటరు శోధన · Voter Search</h1>

      <div className="flex flex-col items-center gap-3 py-4">
        <button onClick={onMic} aria-label="Start voice search"
          className={`flex h-40 w-40 items-center justify-center rounded-full text-6xl text-white shadow-lg transition ${status === 'listening' ? 'animate-pulse bg-red-500' : 'bg-indigo-600 active:scale-95'}`}>
          🎤
        </button>
        <p className="min-h-6 text-center text-sm text-slate-600" aria-live="polite">
          {status === 'listening' ? 'వింటున్నాను… Listening' : status === 'searching' ? 'శోధిస్తున్నాను…' : 'Tap and say a name, voter ID, house, part or serial number'}
        </p>
        {heard && <p className="rounded-lg bg-white px-3 py-2 text-center text-lg shadow-sm">“{heard}”</p>}
      </div>

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { handle(typed.trim()); setTyped(''); } }}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type, e.g. పేరు రాము · ఓటరు ఐడి ABC1234567"
          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2" />
        <button className="rounded-xl bg-slate-800 px-4 text-white">Go</button>
      </form>

      {message && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {active.map(([k, v]) => <span key={k} className="rounded-full bg-indigo-100 px-3 py-1 text-indigo-800">{FIELD_NAMES[k]}: {v}</span>)}
          <button onClick={reset} className="ml-auto text-slate-500 underline">New search</button>
        </div>
      )}

      {selected && <VoterCard v={selected} big onSpeak={() => say(describeVoter(selected))} />}

      {!selected && results.length > 1 && (
        <section aria-label="Matches" className="space-y-2">
          <p className="text-sm text-slate-600">{results.length} matches. Say a field to narrow (house number, father/husband name, part number), or say/tap a number.</p>
          {(showAll ? results : results.slice(0, 10)).map((v, i) => (
            v.img ? (
              <button key={v.id} onClick={() => showVoter(v)} className="block w-full space-y-1 rounded-xl bg-white p-2 text-left shadow-sm">
                <span className="flex items-center gap-2 text-sm"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-white">{i + 1}</span><b>{where(v)}</b></span>
                <CardImage v={v} className="w-full rounded border" />
              </button>
            ) : (
            <button key={v.id} onClick={() => showVoter(v)} className="flex w-full items-center gap-3 rounded-xl bg-white p-3 text-left shadow-sm">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm text-white">{i + 1}</span>
              <span className="min-w-0"><b className="block truncate">{v.name}</b>
                <span className="block truncate text-xs text-slate-500">{[v.relation, v.house && `ఇల్లు ${v.house}`, v.part && `పార్ట్ ${v.part}`, v.serial && `క్రమ ${v.serial}`].filter(Boolean).join(' · ')}</span></span>
            </button>
            )
          ))}
          {!showAll && results.length > 10 && <button onClick={() => setShowAll(true)} className="w-full rounded-xl border border-slate-300 py-2 text-slate-700">Show all {results.length}</button>}
        </section>
      )}
    </main>
  );
}

function CardImage({ v, className }: { v: Voter; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let on = true; getSnippet(v).then((s) => on && setSrc(s)); return () => { on = false; }; }, [v]);
  return src ? <img src={src} alt="Voter card" className={className} /> : <div className={`${className ?? ''} aspect-[7/3] animate-pulse bg-slate-200`} />;
}

const where = (v: Voter) => `పేజీ ${v.page} · వరుస ${v.row} · కాలమ్ ${v.col} · క్రమ సంఖ్య ${v.serial}`;

function VoterCard({ v, big, onSpeak }: { v: Voter; big?: boolean; onSpeak: () => void }) {
  const rows: [string, string][] = [
    ['పేరు', v.name], ['తండ్రి/భర్త', v.relation], ['పార్ట్ నంబర్', v.part], ['క్రమ సంఖ్య', v.serial],
    ['ఇంటి నంబర్', v.house], ['పోలింగ్ కేంద్రం', v.station], ['ఓటరు ఐడి', v.voterId],
  ];
  if (v.img) {
    return (
      <section className="space-y-3 rounded-2xl bg-white p-3 shadow">
        <CardImage v={v} className="w-full rounded-lg border" />
        <dl className="grid grid-cols-3 gap-2 text-center">
          {([['పేజీ', v.page], ['వరుస', v.row], ['కాలమ్', v.col], ['క్రమ సంఖ్య', v.serial]] as const).map(([k, val], i) => (
            <div key={k} className={`rounded-xl bg-indigo-50 py-2 ${i === 3 ? 'col-span-3' : ''}`}>
              <dt className="text-xs text-slate-600">{k}</dt><dd className="text-2xl font-bold text-indigo-700">{val}</dd>
            </div>
          ))}
        </dl>
        <button onClick={onSpeak} className="w-full rounded-xl border border-indigo-600 py-2 text-indigo-700">🔊 మళ్ళీ చెప్పు · Repeat</button>
      </section>
    );
  }
  return (
    <section className={`rounded-2xl bg-white p-4 shadow ${big ? 'text-lg' : ''}`}>
      <dl className="space-y-1">
        {rows.filter(([, val]) => val).map(([k, val]) => (
          <div key={k} className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="text-right font-semibold">{val}</dd></div>
        ))}
      </dl>
      <button onClick={onSpeak} className="mt-3 w-full rounded-xl border border-indigo-600 py-2 text-indigo-700">🔊 మళ్ళీ చెప్పు · Repeat</button>
    </section>
  );
}
