import type { PDFDocumentProxy } from 'pdfjs-dist';

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

/** Legacy build: runs on the older Android WebViews that some team phones still have. */
export function loadPdfjs() {
  pdfjsPromise ??= (async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
    return pdfjs as unknown as typeof import('pdfjs-dist');
  })();
  return pdfjsPromise;
}

/**
 * Opens a PDF by reading only the byte ranges pdf.js asks for. Electoral rolls with photos are 100+ MB,
 * so loading the whole file into memory is avoided. `read` returns the bytes [begin, end).
 */
export async function openRange(size: number, read: (begin: number, end: number) => Promise<Uint8Array>): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  class Ranged extends pdfjs.PDFDataRangeTransport {
    requestDataRange(begin: number, end: number) {
      read(begin, end).then((b) => this.onDataRange(begin, b));
    }
  }
  const initial = await read(0, Math.min(size, 65536));
  return pdfjs.getDocument({
    range: new Ranged(size, initial), length: size,
    disableAutoFetch: true, disableStream: true, rangeChunkSize: 262144,
  } as any).promise;
}

/** The file the user just picked. */
export async function openPdf(file: File): Promise<PDFDocumentProxy> {
  try {
    return await openRange(file.size, async (b, e) => new Uint8Array(await file.slice(b, e).arrayBuffer()));
  } catch {
    const pdfjs = await loadPdfjs();
    return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  }
}
