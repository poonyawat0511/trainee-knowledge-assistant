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
