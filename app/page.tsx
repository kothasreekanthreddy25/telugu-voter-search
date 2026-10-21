'use client';
import { useEffect, useRef, useState } from 'react';
import { getSnippet } from '@/lib/snippet';
import { getDb } from '@/lib/db';
import { parseCommand } from '@/lib/command';
import { parseChoice } from '@/lib/text';
import { skeleton } from '@/lib/fuzzy';
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
      if ((cmd.field === 'name' || cmd.field === 'relation') && skeleton(cmd.value).length < 2) return await say(phrases.tooShort);

      // A different field than before narrows the current search; the same field starts over.
      const refining = results.length > 1 && !(cmd.field in filters);
      const next: Filters = refining ? { ...filters, [cmd.field]: cmd.value } : { [cmd.field]: cmd.value };
      const found = await db.search(next);

      if (!found.length) {
        await say(phrases.notFound);
        return;
      }
      setFilters(next);
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

      {results.length > 1 && <MatchSlider results={results} selected={selected} onPick={showVoter} />}
    </main>
  );
}

/** Swipeable row of every matching card; the card that was picked gets a ring. */
function MatchSlider({ results, selected, onPick }: { results: Voter[]; selected: Voter | null; onPick: (v: Voter) => void }) {
  const [at, setAt] = useState(0);
  return (
    <section aria-label="Matches" className="space-y-2">
      <p className="text-sm text-slate-600">
        {results.length} matches ← swipe →. Tap one to hear it, or say a house number, father/husband name or part number to narrow down.
      </p>
      <div
        className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-3"
        onScroll={(e) => { const el = e.currentTarget; setAt(Math.round(el.scrollLeft / ((el.firstElementChild as HTMLElement)?.offsetWidth + 12 || 1))); }}
      >
        {results.map((v, i) => (
          <button
            key={v.id}
            onClick={() => onPick(v)}
            className={`w-[85%] shrink-0 snap-center space-y-1 rounded-xl bg-white p-2 text-left shadow-sm ${selected?.id === v.id ? 'ring-2 ring-indigo-600' : ''}`}
          >
            <span className="flex items-center gap-2 text-sm">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">{i + 1}</span>
              <b className="truncate">{v.img ? where(v) : v.name}</b>
            </span>
            {v.img ? (
              <CardImage v={v} className="w-full rounded border" />
            ) : (
              <span className="block truncate text-xs text-slate-500">{[v.relation, v.house && `ఇల్లు ${v.house}`, v.part && `పార్ట్ ${v.part}`, v.serial && `క్రమ ${v.serial}`].filter(Boolean).join(' · ')}</span>
            )}
          </button>
        ))}
      </div>
      <p className="text-center text-xs text-slate-500" aria-live="polite">{Math.min(at + 1, results.length)} / {results.length}</p>
    </section>
  );
}

function CardImage({ v, className }: { v: Voter; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setNear(true);
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: '0px 400px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => { if (!near) return; let on = true; getSnippet(v).then((s) => on && setSrc(s)); return () => { on = false; }; }, [v, near]);
  return src ? <img src={src} alt="Voter card" className={className} /> : <div ref={box} className={`${className ?? ''} aspect-[7/3] animate-pulse bg-slate-200`} />;
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
