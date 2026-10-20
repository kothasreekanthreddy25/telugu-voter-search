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
 * Opens a PDF straight from the picked file, reading only the byte ranges pdf.js asks for.
 * Electoral rolls with photos are 100+ MB, so loading the whole file into memory is avoided.
 */
export async function openPdf(file: File): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  class BlobRange extends pdfjs.PDFDataRangeTransport {
    requestDataRange(begin: number, end: number) {
      file.slice(begin, end).arrayBuffer().then((b) => this.onDataRange(begin, new Uint8Array(b)));
    }
  }
  try {
    const initial = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
    return await pdfjs.getDocument({
      range: new BlobRange(file.size, initial), length: file.size,
      disableAutoFetch: true, disableStream: true, rangeChunkSize: 262144,
    } as any).promise;
  } catch {
    return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  }
}
