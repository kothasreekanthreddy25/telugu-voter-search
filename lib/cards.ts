import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

/** Card snippets are small JPEGs kept in app-private storage (not visible to other apps or the gallery). */
const webStore = new Map<string, string>(); // browser preview only: lost on reload
const native = () => Capacitor.isNativePlatform();

const blobToBase64 = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

export async function saveCard(listId: number, name: string, jpeg: Blob): Promise<string> {
  const path = `cards/${listId}/${name}.jpg`;
  if (native()) {
    await Filesystem.writeFile({ path, data: await blobToBase64(jpeg), directory: Directory.Data, recursive: true });
  } else {
    webStore.set(path, URL.createObjectURL(jpeg));
  }
  return path;
}

const srcCache = new Map<string, string>();
export async function cardSrc(path: string): Promise<string | null> {
  if (!native()) return webStore.get(path) ?? null;
  const hit = srcCache.get(path);
  if (hit) return hit;
  try {
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
    const src = Capacitor.convertFileSrc(uri);
    srcCache.set(path, src);
    return src;
  } catch {
    return null;
  }
}

export async function deleteCards(listId: number) {
  const prefix = `cards/${listId}/`;
  if (native()) {
    await Filesystem.rmdir({ path: `cards/${listId}`, directory: Directory.Data, recursive: true }).catch(() => {});
  } else {
    for (const k of [...webStore.keys()]) if (k.startsWith(prefix)) { URL.revokeObjectURL(webStore.get(k)!); webStore.delete(k); }
  }
}

export async function deleteAllCards() {
  if (native()) await Filesystem.rmdir({ path: 'cards', directory: Directory.Data, recursive: true }).catch(() => {});
  else { webStore.forEach((u) => URL.revokeObjectURL(u)); webStore.clear(); }
}
