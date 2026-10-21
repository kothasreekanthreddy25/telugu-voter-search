import { Capacitor } from '@capacitor/core';
import type { Voter } from './types';

export const LANG = 'te-IN';
const native = () => Capacitor.isNativePlatform();

const RATE_KEY = 'voice-rate';
export const getRate = () => {
  try { return Number(localStorage.getItem(RATE_KEY)) || 0.9; } catch { return 0.9; }
};
export const setRate = (r: number) => { try { localStorage.setItem(RATE_KEY, String(r)); } catch { /* ignore */ } };

/** Resolves with the best Telugu transcript, or throws a user-readable Error. */
export async function listen(): Promise<string> {
  if (native()) {
    const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
    if (!(await SpeechRecognition.available()).available) throw new Error('Speech recognition is not available on this device.');
    const perm = await SpeechRecognition.requestPermissions();
    if (perm.speechRecognition !== 'granted') throw new Error('Microphone permission is required.');
    const res = await SpeechRecognition.start({ language: LANG, maxResults: 3, partialResults: false, popup: false });
    const text = res.matches?.[0];
    if (!text) throw new Error('Nothing was heard.');
    return text;
  }
  const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  if (!Ctor) throw new Error('Speech recognition is not supported in this browser.');
  return new Promise((resolve, reject) => {
    const rec = new Ctor();
    rec.lang = LANG;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => resolve(e.results[0][0].transcript);
    rec.onerror = (e: any) => reject(new Error(e.error === 'no-speech' ? 'Nothing was heard.' : `Speech error: ${e.error}`));
    rec.onend = () => reject(new Error('Nothing was heard.'));
    rec.start();
  });
}

export async function stopListening() {
  if (native()) {
    const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
    await SpeechRecognition.stop().catch(() => {});
  }
}

export async function speak(text: string): Promise<void> {
  if (native()) {
    const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
    await TextToSpeech.stop().catch(() => {});
    await TextToSpeech.speak({ text, lang: LANG, rate: getRate(), pitch: 1, volume: 1 });
    return;
  }
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  await new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANG;
    u.rate = getRate();
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export async function stopSpeaking() {
  if (native()) {
    const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
    await TextToSpeech.stop().catch(() => {});
  } else if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

export interface Capability { speechInput: boolean; speechOutput: boolean; note: string }

/** Offline support varies by device, so settings shows what this phone reports. */
export async function checkCapabilities(): Promise<Capability> {
  try {
    if (native()) {
      const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
      const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
      const input = (await SpeechRecognition.available()).available;
      const output = (await TextToSpeech.isLanguageSupported({ lang: LANG })).supported;
      return {
        speechInput: input, speechOutput: output,
        note: 'For offline use, install the Telugu language pack: Settings > Google > Voice > Offline speech recognition, and Telugu text-to-speech voice data.',
      };
    }
    const input = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    const output = 'speechSynthesis' in window && window.speechSynthesis.getVoices().some((v) => v.lang.startsWith('te'));
    return { speechInput: input, speechOutput: output, note: 'Browser preview: speech recognition uses an online service.' };
  } catch {
    return { speechInput: false, speechOutput: false, note: 'Could not query speech services.' };
  }
}

/** Telugu sentences spoken back. Only fields present in the source are read. */
export const phrases = {
  ready: 'ఏమి వెతకాలో చెప్పండి.',
  notUnderstood: 'అర్థం కాలేదు. దయచేసి మళ్ళీ చెప్పండి.',
  tooShort: 'దయచేసి పూర్తి పేరు చెప్పండి.',
  notFound: 'ఎవరూ దొరకలేదు. దయచేసి మళ్ళీ చెప్పండి.',
  noData: 'డేటాబేస్‌లో ఓటర్ల జాబితా లేదు. దయచేసి అడ్మిన్ జాబితాను దిగుమతి చేయాలి.',
  tooMany: (n: number) =>
    `${n} మంది దొరికారు. దయచేసి ఇంటి నంబర్, తండ్రి పేరు లేదా పార్ట్ నంబర్ చెప్పి శోధనను తగ్గించండి.`,
  few: (n: number) =>
    `${n} మంది దొరికారు. జాబితా నుండి ఒకరిని ఎంచుకోండి, లేదా ఇంటి నంబర్ లేదా తండ్రి పేరు చెప్పండి.`,
};

export function describeVoter(v: Voter): string {
  // Card from a PDF roll: tell the person where to find it in the printed list.
  if (v.pdfPage) return `పేజీ నంబర్ ${v.page}. కాలమ్ ${v.col}. క్రమ సంఖ్య ${v.serial}.`;
  const parts = [v.name];
  if (v.relation) parts.push(`తండ్రి లేదా భర్త పేరు ${v.relation}`);
  if (v.part) parts.push(`పార్ట్ నంబర్ ${v.part}`);
  if (v.serial) parts.push(`క్రమ సంఖ్య ${v.serial}`);
  if (v.house) parts.push(`ఇంటి నంబర్ ${v.house}`);
  if (v.station) parts.push(`పోలింగ్ కేంద్రం ${v.station}`);
  if (v.voterId) parts.push(`ఓటరు ఐడి ${v.voterId.split('').join(' ')}`);
  return parts.join('. ') + '.';
}
