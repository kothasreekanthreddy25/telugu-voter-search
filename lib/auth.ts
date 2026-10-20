import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';

export type Role = 'admin' | 'team';

const MAX_TRIES = 5;
const LOCK_MS = 30_000;

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
const get = async (k: string) => (await Preferences.get({ key: k })).value;
const set = (k: string, value: string) => Preferences.set({ key: k, value });

/** PINs are stored only as salted hashes. */
export async function setPin(role: Role, pin: string) {
  if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN must be 4 to 8 digits.');
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  await set(`pin-${role}`, `${salt}:${await sha256(salt + pin)}`);
}
export async function hasPin(role: Role) { return !!(await get(`pin-${role}`)); }
export async function clearPin(role: Role) { await Preferences.remove({ key: `pin-${role}` }); }

/** Returns true on success; throws with a message when locked out. */
export async function verifyPin(role: Role, pin: string): Promise<boolean> {
  const until = Number(await get(`lock-${role}`)) || 0;
  if (until > Date.now()) throw new Error(`Too many attempts. Try again in ${Math.ceil((until - Date.now()) / 1000)} s.`);
  const stored = await get(`pin-${role}`);
  if (!stored) return true;
  const [salt, hash] = stored.split(':');
  if ((await sha256(salt + pin)) === hash) {
    await set(`tries-${role}`, '0');
    return true;
  }
  const tries = (Number(await get(`tries-${role}`)) || 0) + 1;
  if (tries >= MAX_TRIES) {
    await set(`lock-${role}`, String(Date.now() + LOCK_MS));
    await set(`tries-${role}`, '0');
  } else await set(`tries-${role}`, String(tries));
  return false;
}

export async function biometricAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    return (await BiometricAuth.checkBiometry()).isAvailable;
  } catch { return false; }
}

export async function biometricUnlock(): Promise<boolean> {
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    await BiometricAuth.authenticate({ reason: 'Unlock Voter Search', allowDeviceCredential: true });
    return true;
  } catch { return false; }
}

export const biometricEnabled = async () => (await get('biometric')) === '1';
export const setBiometricEnabled = (on: boolean) => set('biometric', on ? '1' : '0');

/** The admin PIN is optional: first-time users can skip it and set one later in Settings. */
export const setupSkipped = async () => (await get('setup-skipped')) === '1';
export const skipSetup = () => set('setup-skipped', '1');
