'use client';
import { useEffect, useState } from 'react';
import { AdminGate, PinField, useSession } from '@/components/Session';
import { biometricAvailable, biometricEnabled, clearPin, hasPin, setBiometricEnabled, setPin } from '@/lib/auth';
import { checkCapabilities, getRate, setRate, speak, type Capability } from '@/lib/voice';

export default function SettingsPage() {
  const { lockAll } = useSession();
  return (
    <main className="space-y-5 p-5">
      <h1 className="text-xl font-bold">Settings</h1>
      <VoiceSettings />
      <h2 className="pt-2 text-lg font-semibold">Security (admin)</h2>
      <AdminGate><Security /></AdminGate>
      <button onClick={lockAll} className="w-full rounded-xl border border-slate-400 py-3">🔒 Lock app now</button>
    </main>
  );
}

function VoiceSettings() {
  const [cap, setCap] = useState<Capability | null>(null);
  const [rate, setRateState] = useState(0.9);
  useEffect(() => { setRateState(getRate()); checkCapabilities().then(setCap); }, []);
  const Tick = ({ ok }: { ok: boolean }) => <b className={ok ? 'text-green-600' : 'text-red-600'}>{ok ? '✓ available' : '✗ not available'}</b>;
  return (
    <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="font-semibold">Telugu speech</h2>
      {cap && (
        <ul className="space-y-1 text-sm">
          <li>Speech recognition (te-IN): <Tick ok={cap.speechInput} /></li>
          <li>Speech output (te-IN): <Tick ok={cap.speechOutput} /></li>
          <li className="text-xs text-slate-500">{cap.note}</li>
        </ul>
      )}
      <label className="block text-sm">Speaking speed: {rate.toFixed(1)}×
        <input type="range" min={0.5} max={1.5} step={0.1} value={rate} className="w-full"
          onChange={(e) => { const r = Number(e.target.value); setRateState(r); setRate(r); }} />
      </label>
      <button onClick={() => speak('నమస్కారం. ఇది పరీక్ష.')} className="w-full rounded-xl border border-indigo-600 py-2 text-indigo-700">🔊 Test Telugu voice</button>
    </section>
  );
}

function Security() {
  const [team, setTeam] = useState(false);
  const [bio, setBio] = useState(false);
  const [bioOk, setBioOk] = useState(false);
  const [msg, setMsg] = useState('');
  const refresh = async () => { setTeam(await hasPin('team')); setBio(await biometricEnabled()); setBioOk(await biometricAvailable()); };
  useEffect(() => { refresh(); }, []);

  return (
    <div className="space-y-4">
      {msg && <p className="rounded-xl bg-green-50 p-3 text-sm text-green-800">{msg}</p>}
      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="font-semibold">Team PIN {team ? '(set)' : '(not set: anyone opening the app can search)'}</h3>
        <PinField label={team ? 'New team PIN' : 'Set team PIN'} submitText="Save team PIN"
          onSubmit={async (p) => { await setPin('team', p); await refresh(); setMsg('Team PIN saved.'); }} />
        {team && <button className="text-sm text-red-600 underline" onClick={async () => { await clearPin('team'); await setBiometricEnabled(false); await refresh(); setMsg('Team PIN removed.'); }}>Remove team PIN</button>}
        {team && bioOk && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={bio} onChange={async (e) => { await setBiometricEnabled(e.target.checked); await refresh(); }} />
            Allow fingerprint / device lock to unlock
          </label>
        )}
      </section>
      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="font-semibold">Change admin PIN</h3>
        <PinField label="New admin PIN" submitText="Change admin PIN"
          onSubmit={async (p) => { await setPin('admin', p); setMsg('Admin PIN changed.'); }} />
      </section>
      <p className="text-xs text-slate-500">The voter database is encrypted on the device, there is no export feature, and Android backup is disabled.</p>
    </div>
  );
}
