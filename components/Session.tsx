'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { biometricAvailable, biometricEnabled, biometricUnlock, hasPin, setPin, setupSkipped, skipSetup, verifyPin, type Role } from '@/lib/auth';

interface Ctx { admin: boolean; unlockAdmin: (pin: string) => Promise<boolean>; lockAdmin: () => void; lockAll: () => void }
const SessionCtx = createContext<Ctx | null>(null);
export const useSession = () => useContext(SessionCtx)!;

type Phase = 'loading' | 'setup' | 'locked' | 'open';

export function PinField({ onSubmit, label, submitText = 'OK' }: { onSubmit: (pin: string) => Promise<string | void>; label: string; submitText?: string }) {
  const [pin, setPinValue] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { setErr((await onSubmit(pin)) ?? ''); } catch (x) { setErr((x as Error).message); }
    setPinValue('');
    setBusy(false);
  }
  return (
    <form onSubmit={go} className="space-y-3">
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      <input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin}
        onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ''))}
        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-2xl tracking-[0.5em]" />
      {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      <button disabled={busy || pin.length < 4} className="w-full rounded-xl bg-indigo-600 py-3 font-semibold text-white disabled:opacity-40">{submitText}</button>
    </form>
  );
}

export function Session({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [admin, setAdmin] = useState(false);
  const [bio, setBio] = useState(false);

  const evaluate = useCallback(async () => {
    if (!(await hasPin('admin')) && !(await setupSkipped())) return setPhase('setup');
    if (await hasPin('team')) {
      setPhase('locked');
      if ((await biometricEnabled()) && (await biometricAvailable()) && (await biometricUnlock())) setPhase('open');
      setBio((await biometricEnabled()) && (await biometricAvailable()));
    } else setPhase('open');
  }, []);

  useEffect(() => { evaluate(); }, [evaluate]);

  // Re-lock when the app goes to the background.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') { setAdmin(false); hasPin('team').then((t) => t && setPhase('locked')); } };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  const ctx: Ctx = {
    admin,
    unlockAdmin: async (pin) => { const ok = await verifyPin('admin', pin); if (ok) setAdmin(true); return ok; },
    lockAdmin: () => setAdmin(false),
    lockAll: () => { setAdmin(false); evaluate(); },
  };

  if (phase === 'loading') return <p className="p-8 text-center text-slate-500">Loading…</p>;

  if (phase === 'setup')
    return (
      <Center title="Set a PIN" sub="Recommended. A PIN protects deleting voter lists and the security settings. You can skip this and set it later in Settings.">
        <PinField label="Choose a 4–8 digit admin PIN" submitText="Save PIN"
          onSubmit={async (pin) => { try { await setPin('admin', pin); setAdmin(true); setPhase('open'); } catch (e) { return (e as Error).message; } }} />
        <button onClick={async () => { await skipSetup(); setPhase('open'); }} className="w-full rounded-xl border border-slate-300 py-3 text-slate-700">Skip for now</button>
      </Center>
    );

  if (phase === 'locked')
    return (
      <Center title="Voter Search" sub="Enter your team PIN (or admin PIN) to continue.">
        <PinField label="PIN" onSubmit={async (pin) => {
          const roles: Role[] = ['team', 'admin'];
          for (const r of roles) if (await verifyPin(r, pin)) { if (r === 'admin') setAdmin(true); setPhase('open'); return; }
          return 'Incorrect PIN.';
        }} />
        {bio && <button onClick={async () => (await biometricUnlock()) && setPhase('open')} className="mt-4 w-full rounded-xl border border-slate-300 py-3 text-slate-700">Use fingerprint / device lock</button>}
      </Center>
    );

  return <SessionCtx.Provider value={ctx}>{children}</SessionCtx.Provider>;
}

function Center({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-sm text-slate-600">{sub}</p>
      {children}
    </main>
  );
}

/** Wraps admin-only screens. */
export function AdminGate({ children }: { children: ReactNode }) {
  const { admin, unlockAdmin } = useSession();
  const [pinSet, setPinSet] = useState<boolean | null>(null);
  useEffect(() => { hasPin('admin').then(setPinSet); }, []);
  if (pinSet === null) return null;
  if (admin || !pinSet) return <>{children}</>;
  return (
    <div className="mx-auto max-w-sm space-y-3 rounded-2xl bg-white p-6 shadow">
      <h2 className="text-lg font-semibold">Admin access required</h2>
      <PinField label="Admin PIN" onSubmit={async (pin) => ((await unlockAdmin(pin)) ? undefined : 'Incorrect PIN.')} />
    </div>
  );
}
