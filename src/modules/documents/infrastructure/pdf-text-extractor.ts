import './pdf-polyfills'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { PDFParse } from 'pdf-parse'
import type { TextExtractor } from '../application/ports'

// pdf-parse's underlying pdfjs-dist engine dynamically imports its worker
// script at parse time using a path relative to its own bundled module.
// Under Next.js's server bundler that relative path doesn't resolve, so we
// resolve the real on-disk worker file (via pdf-parse's own dependency
// resolution, since pnpm doesn't hoist pdfjs-dist to our package) and point
// pdfjs-dist's GlobalWorkerOptions at it explicitly before the first parse.
//
// IMPORTANT — no code-level recovery if this runs too late: pdfjs-dist's
// `PDFWorker._setupFakeWorkerGlobal` is a class-level static getter that
// memoizes its result (success OR rejection) exactly once, forever, for the
// life of the process (it uses an internal `shadow()` helper to replace the
// getter with a plain cached value/promise on first access). If the very
// first PDF parse in a fresh process happens before `ensureWorkerConfigured`
// runs (or runs with a bad path), that failure is cached permanently —
// every subsequent PDF upload in that same process will keep failing with
// "Setting up fake worker failed", even after this file is fixed and
// hot-reloaded, because pdfjs-dist itself isn't recompiled by unrelated
// edits. There is no in-process retry that can clear this; the only fix is
// a full process restart (e.g. restarting `next dev`, or a fresh deploy).
let workerConfigured = false
function ensureWorkerConfigured(): void {
  if (workerConfigured) return
  const require = createRequire(import.meta.url)
  const pdfParseEntry = require.resolve('pdf-parse')
  const workerPath = require.resolve(
    /* turbopackIgnore: true */ 'pdfjs-dist/legacy/build/pdf.worker.mjs',
    { paths: [pdfParseEntry] }
  )
  PDFParse.setWorker(pathToFileURL(workerPath).href)
  workerConfigured = true
}

export class PdfTextExtractor implements TextExtractor {
  async extract(buffer: Buffer, mimeType: string): Promise<string> {
    if (mimeType === 'text/plain') {
      return buffer.toString('utf-8')
    }
    if (mimeType === 'application/pdf') {
      ensureWorkerConfigured()
      const parser = new PDFParse({ data: buffer })
      try {
        const result = await parser.getText()
        return result.text
      } finally {
        await parser.destroy()
      }
    }
    throw new Error(`Unsupported mime type: ${mimeType}`)
  }
}
