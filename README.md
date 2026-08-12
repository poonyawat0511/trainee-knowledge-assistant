# Knowledge Assistant

## Tech Stack

- **Frontend/Backend:** Next.js 16.3 (App Router), TypeScript, Tailwind CSS
- **Database:** SQLite via `sql.js` (WASM SQLite, no ORM — schema is small enough that a query builder would be overhead; switched from `better-sqlite3`, see Known Issues)
- **Vector DB:** none — RAG was explicitly skipped for this pass (see `DECISIONS.md`). Uploaded document text is injected into the chat context directly instead of chunked/embedded/retrieved.
- **AI provider:** OpenRouter (OpenAI-compatible chat completions API), called via plain `fetch`, no SDK dependency
- **Auth:** bcrypt password hashing (`bcryptjs`) + JWT (`jose`) in an httpOnly/secure/sameSite=strict cookie
- **File parsing:** `pdf-parse` for PDF, direct read for TXT
- **Testing:** Vitest, scoped to the `application/` (use-case) layer with mocked ports
- **Deploy:** Docker Compose (single service, see Known Issues below for a sandbox-specific caveat)

## Setup & Run

```bash
cp .env.example .env
# fill in OPENROUTER_API_KEY and a real JWT_SECRET in .env
docker compose up
```

The mock login is `admin` / `admin123` (seeded automatically on first login attempt).

For local development without Docker:

```bash
pnpm install
pnpm seed   # seeds the admin user into ./data/app.db
pnpm dev
```

## Features Done

- [x] Login + Protected Routes (bcrypt + JWT session cookie, `proxy.ts` guard)
- [x] File Upload (inline attach in the chat compose box, PDF/TXT, type/size validation, no raw file persisted to disk — only extracted text; each conversation only sees the documents attached to it)
- [x] Chat with AI (OpenRouter, timeout + retry-on-network-failure, error handling)
- [x] Chat with Uploaded File Context (document text injected into chat context, truncated to a token budget for large files)
- [x] Token Usage Counter (per-message and running session total)
- [x] Markdown rendering in AI responses
- [x] Streaming responses (SSE)
- [x] Conversation history (save/load, including loading a past conversation's messages on switch)
- [x] Rate limiting (per-user token bucket, shared across the streaming and non-streaming chat endpoints)
- [x] Docker Compose + healthcheck (see Known Issues — not confirmed working end-to-end in the sandbox this was built in)
- [x] Unit tests (application-layer use-cases, mocked ports)
- [ ] RAG with Vector DB (not done — see `DECISIONS.md`)

## Architecture

Each feature is a module under `src/modules/` (`auth`, `documents`, `chat`), organized as clean architecture layers:

- **`domain/`** — entities and types, no framework or library imports
- **`application/`** — use-cases and port interfaces (`UserRepository`, `AiProvider`, etc.); imports only `domain` and its own `ports.ts`, never a concrete infrastructure class
- **`infrastructure/`** — concrete implementations of the ports (SQLite repositories, the OpenRouter adapter, bcrypt/JWT services); free to import third-party libraries

`src/app/` (Next.js route handlers and pages) is the presentation layer: each route composes a use-case with its concrete infrastructure via a small factory function (no DI container) and does nothing else — auth check, input validation, use-case call, response shaping.

`src/proxy.ts` is the edge auth guard (Next.js 16's `proxy.js` convention — `middleware.js` is deprecated in this Next.js version). It verifies the session JWT before protected routes/pages are reached.

The one deliberate cross-module exception: `src/modules/chat/infrastructure/document-text-lookup.ts` is the only file in the `chat` module allowed to import from `documents` — it adapts `documents`' repository to a narrow `DocumentTextLookup` port that `chat/application` depends on, keeping the module boundary at the infrastructure edge rather than in application logic.

## Known Issues

- **Resolved: Docker Compose used to crash on every DB-touching request (SIGSEGV).** `better-sqlite3` (a native addon) was confirmed — via a from-source rebuild inside the container, with wrong-architecture prebuilts and QEMU emulation on Apple Silicon both independently ruled out first — to segfault inside Docker Desktop's VM on the deployment machine even when compiled specifically for that exact container. Isolated down to a bare `require('better-sqlite3'); new Database(':memory:')` outside any application code, so it was conclusively a native-addon/virtualization-layer interaction, not a code defect. Fixed by replacing `better-sqlite3` with `sql.js` (a WASM build of SQLite) throughout — WASM has no `dlopen`/native-addon code path, so it isn't susceptible to this class of failure. The trade-off: `sql.js` has no built-in file persistence, so `src/shared/db/client.ts` loads the whole database into memory on first use and re-exports/writes it back to disk after every write; fine at this project's data volume, would not scale to a large database.
- **Resolved: `pdf-parse` crashed the whole server on any request, not just PDF uploads.** `pdf-parse`'s underlying `pdfjs-dist` engine references `DOMMatrix`/`ImageData`/`Path2D` (browser-only APIs) at module-evaluation time, for an optional canvas-rendering path this project's text-only extraction never uses. Next.js/Turbopack bundles every API route into one shared server chunk, so importing *any* route (even `/api/auth/login`) evaluated that code and threw `ReferenceError: DOMMatrix is not defined`, crashing whichever request happened to trigger the chunk's first evaluation. Fixed with minimal no-op global stubs for those three APIs (`src/modules/documents/infrastructure/pdf-polyfills.ts`, imported before `pdf-parse` specifically so the stubs exist before `pdfjs-dist`'s module body runs) — no real canvas implementation needed, confirmed via a real PDF upload/extraction test that text extraction still works correctly.
- **Resolved: the first chat message after a fresh "New chat" sometimes failed, with the next message succeeding.** OpenRouter's free-tier models share a rate-limited pool upstream and occasionally return `429` with a `retry_after_seconds` hint that clears within seconds — this is normal, expected behavior for the free tier, not an application bug. `OpenRouterProvider`'s retry logic previously never retried any HTTP error status (deliberately, since most 4xx/5xx will never succeed on retry). Fixed by special-casing the genuinely transient statuses (`429`, `502`, `503`, `504`) for a single short-delayed retry, while still never retrying deterministic errors like `400`/`401`.
- **RAG is not implemented.** Large uploaded documents are truncated to a fixed character budget (~12,000 chars, roughly 3,000 tokens) before being injected as chat context, rather than retrieved via chunking/embedding/vector search. See `DECISIONS.md`.
- **Rate limiter state is in-memory** and resets on process restart — acceptable for the single-container deployment this project targets, not suitable for horizontal scaling without moving to shared state (e.g. Redis).
- **Partial streamed AI replies are not persisted if the stream fails mid-response.** If the AI provider's connection drops after some tokens have already streamed to the browser, that partial text is not saved to the conversation history — a page reload will show no assistant message for that turn.
- **`OPENROUTER_API_KEY` must be supplied for full end-to-end chat verification.** Most of this project's chat/streaming/rate-limiting code was verified against the real route/DB/auth layers with the key left blank (confirming correct error handling: a clean 502 rather than a crash), but the actual AI-reply success path needs a real key to exercise fully.
