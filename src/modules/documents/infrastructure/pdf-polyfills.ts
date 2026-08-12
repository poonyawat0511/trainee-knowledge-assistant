// pdfjs-dist (pdf-parse's underlying engine) references DOMMatrix/ImageData/
// Path2D — browser-only APIs — at module-evaluation time, for its optional
// canvas-based page-rendering path. This project only uses pdf-parse for
// text extraction and never exercises that rendering path, so minimal
// no-op stubs are enough to stop pdfjs-dist throwing `ReferenceError:
// DOMMatrix is not defined` on import; no real canvas implementation
// (e.g. @napi-rs/canvas, which also brings its own native-binary Docker
// bundling problems) is needed.
//
// This file must have no imports of its own and must be imported before
// `pdf-parse` whichever module first imports it — ES module evaluation
// runs each import's dependency graph to completion, in source order,
// before executing the importing file's own body, so as long as this
// import statement appears first, these globals exist before pdfjs-dist's
// module body runs.

if (typeof globalThis.DOMMatrix === 'undefined') {
  class NoopDOMMatrix {}
  ;(globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = NoopDOMMatrix
}

if (typeof globalThis.ImageData === 'undefined') {
  class NoopImageData {}
  ;(globalThis as unknown as { ImageData: unknown }).ImageData = NoopImageData
}

if (typeof globalThis.Path2D === 'undefined') {
  class NoopPath2D {}
  ;(globalThis as unknown as { Path2D: unknown }).Path2D = NoopPath2D
}
