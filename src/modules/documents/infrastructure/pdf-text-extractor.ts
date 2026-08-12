import './pdf-polyfills'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PDFParse } from 'pdf-parse'
import type { TextExtractor } from '../application/ports'

// pdf-parse's underlying pdfjs-dist engine dynamically imports its worker
// script at parse time using a path relative to its own bundled module.
// Under Next.js's server bundler that relative path doesn't resolve, so we
// resolve the real on-disk worker file ourselves and point pdfjs-dist's
// GlobalWorkerOptions at it explicitly before the first parse.
//
// This deliberately does NOT use `require.resolve()` (even via
// `createRequire`) or `import.meta.resolve()`: both were observed to behave
// differently between `next dev` and a production standalone build under
// Turbopack — in the production build, `require.resolve('pdf-parse')`
// returned an internal Turbopack module id (a number) instead of a real
// file path, breaking the "resolve pdfjs-dist relative to pdf-parse's own
// dependency context" trick this previously relied on
// (`require.resolve(x, { paths: [...] })`) with a runtime
// `TypeError: The "paths[0]" argument must be of type string`. Plain `fs`
// calls are not part of module resolution, so Turbopack has no reason to
// intercept them — walking the pnpm virtual store directly from
// `process.cwd()` (matching the same anchor already used for
// `schema.sql`'s path elsewhere in this codebase) is robust across both
// `next dev` and a production/Docker build.
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

function findPdfWorkerPath(): string {
  // The Dockerfile's `deps` stage copies the worker file to this fixed,
  // version-independent location, because Next's file tracer never learns
  // it needs to bundle pdf.worker.mjs into the standalone build output (we
  // load it dynamically at runtime via a path Turbopack can't statically
  // see) — confirmed missing via `find .next/standalone -iname
  // pdf.worker.mjs` returning nothing after a real production build. Check
  // this vendored copy first; it's the only path that exists in the Docker
  // runner image.
  const vendoredPath = path.join(process.cwd(), 'vendor', 'pdf-worker', 'pdf.worker.mjs')
  if (fs.existsSync(vendoredPath)) return vendoredPath

  // Local/dev fallback: search the real pnpm virtual store directly.
  let dir = process.cwd()

  while (true) {
    const pnpmDir = path.join(dir, 'node_modules', '.pnpm')
    if (fs.existsSync(pnpmDir)) {
      const pdfjsDirName = fs.readdirSync(pnpmDir).find((entry) => entry.startsWith('pdfjs-dist@'))
      if (pdfjsDirName) {
        const workerPath = path.join(
          pnpmDir,
          pdfjsDirName,
          'node_modules',
          'pdfjs-dist',
          'legacy',
          'build',
          'pdf.worker.mjs'
        )
        if (fs.existsSync(workerPath)) return workerPath
      }
    }

    const parentDir = path.dirname(dir)
    if (parentDir === dir) break
    dir = parentDir
  }

  throw new Error(
    `Could not locate pdfjs-dist's worker file under node_modules/.pnpm starting from ${process.cwd()}`
  )
}

function ensureWorkerConfigured(): void {
  if (workerConfigured) return
  const workerPath = findPdfWorkerPath()
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
