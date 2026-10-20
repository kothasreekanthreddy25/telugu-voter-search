import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { openPdf, openRange } from './pdf';

/** A private copy of each imported roll, so card pictures can be cut out later without asking for the file again. */
const native = () => Capacitor.isNativePlatform();
const rollPath = (listId: number) => `rolls/${listId}.pdf`;
const CHUNK = 3 * 1024 * 1024;

const webFiles = new Map<number, File>(); // browser preview only: lost on reload
const open = new Map<number, Promise<PDFDocumentProxy>>();

const toBase64 = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function storeRoll(listId: number, file: File, onProgress: (fraction: number) => void) {
  if (!native()) { webFiles.set(listId, file); onProgress(1); return; }
  const path = rollPath(listId);
  await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => {});
  for (let at = 0; at < file.size; at += CHUNK) {
    const data = await toBase64(file.slice(at, at + CHUNK));
    if (at === 0) await Filesystem.writeFile({ path, data, directory: Directory.Data, recursive: true });
    else await Filesystem.appendFile({ path, data, directory: Directory.Data });
    onProgress(Math.min(1, (at + CHUNK) / file.size));
  }
}

export function openStoredRoll(listId: number): Promise<PDFDocumentProxy> {
  let doc = open.get(listId);
  if (!doc) {
    doc = (async () => {
      if (!native()) {
        const f = webFiles.get(listId);
        if (!f) throw new Error('Roll file is not available');
        return openPdf(f);
      }
      const path = rollPath(listId);
      const { size } = await Filesystem.stat({ path, directory: Directory.Data });
      return openRange(size, async (begin, end) => {
        const r = await Filesystem.readFile({ path, directory: Directory.Data, offset: begin, length: end - begin });
        return fromBase64(r.data as string);
      });
    })();
    doc.catch(() => open.delete(listId));
    open.set(listId, doc);
  }
  return doc;
}

export async function deleteRoll(listId: number) {
  webFiles.delete(listId);
  const d = open.get(listId);
  open.delete(listId);
  await (await d?.catch(() => null) as any)?.destroy?.();
  if (native()) await Filesystem.deleteFile({ path: rollPath(listId), directory: Directory.Data }).catch(() => {});
}

export async function deleteAllRolls() {
  webFiles.clear();
  open.clear();
  if (native()) await Filesystem.rmdir({ path: 'rolls', directory: Directory.Data, recursive: true }).catch(() => {});
}
