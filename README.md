# Knowledge Assistant

## Tech Stack

- **Frontend/Backend:** Next.js 16.3 (App Router), TypeScript, Tailwind CSS
- **Database:** SQLite via `better-sqlite3` (no ORM — schema is small enough that a query builder would be overhead)
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
- [x] File Upload (PDF/TXT, type/size validation, no raw file persisted to disk — only extracted text)
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
- [ ] Citation of source spans (depends on RAG chunking, skipped alongside it)

## Architecture

Each feature is a module under `src/modules/` (`auth`, `documents`, `chat`), organized as clean architecture layers:

- **`domain/`** — entities and types, no framework or library imports
- **`application/`** — use-cases and port interfaces (`UserRepository`, `AiProvider`, etc.); imports only `domain` and its own `ports.ts`, never a concrete infrastructure class
- **`infrastructure/`** — concrete implementations of the ports (SQLite repositories, the OpenRouter adapter, bcrypt/JWT services); free to import third-party libraries

`src/app/` (Next.js route handlers and pages) is the presentation layer: each route composes a use-case with its concrete infrastructure via a small factory function (no DI container) and does nothing else — auth check, input validation, use-case call, response shaping.

`src/proxy.ts` is the edge auth guard (Next.js 16's `proxy.js` convention — `middleware.js` is deprecated in this Next.js version). It verifies the session JWT before protected routes/pages are reached.

The one deliberate cross-module exception: `src/modules/chat/infrastructure/document-text-lookup.ts` is the only file in the `chat` module allowed to import from `documents` — it adapts `documents`' repository to a narrow `DocumentTextLookup` port that `chat/application` depends on, keeping the module boundary at the infrastructure edge rather than in application logic.

## Known Issues

- **Docker Compose does not run end-to-end reliably.** The container serves `/api/health` correctly, but crashes (SIGSEGV, exit 139) on the first request that touches `better-sqlite3`'s native binding (e.g. login). Reproduced on two independent machines/environments, so this is not a one-off fluke. Ruled out so far, with evidence:
  - **Not an OOM-kill** — `docker inspect`'s `OOMKilled` is `false` on every crash observed.
  - **Not a base-image issue** — identical crash on both `node:20-slim` and `node:20-bookworm`.
  - **Not a wrong-architecture prebuilt binary** — `better-sqlite3`'s bundled native binding was deleted and recompiled from source inside the container (`Dockerfile`'s `deps` stage runs `node-gyp rebuild` after `apt-get install`ing `python3 make g++`; build log confirms `gyp info ok`), and the crash persists identically with a binary built specifically for that container.
  - **Not QEMU emulation on Apple Silicon** — `docker-compose.yml` pins `platform: linux/arm64`, and `uname -m` / `node -e "console.log(process.arch)"` run inside the container both confirm genuine native `arm64`/`aarch64`, not an emulated `amd64` image.
  - Outside Docker, on the host directly, the identical native-binding-segfault symptom was also seen and *was* fixed by the same source-rebuild approach — suggesting the underlying fragility is real (prebuilt `.node` binaries for this package are not fully reliable in some environments) but Docker Desktop's VM specifically still crashes even with a freshly-compiled binary, which the host environment did not.
  - Root cause is still not conclusively identified — it looks like a Docker Desktop virtualization-layer issue interacting with this native addon rather than anything fixable in this project's code, but that's an informed guess, not a confirmed diagnosis. The Dockerfile/compose structure itself (stages, secret handling, healthcheck target) was reviewed and is believed correct independent of this issue.
- **RAG is not implemented.** Large uploaded documents are truncated to a fixed character budget (~12,000 chars, roughly 3,000 tokens) before being injected as chat context, rather than retrieved via chunking/embedding/vector search. See `DECISIONS.md`.
- **Rate limiter state is in-memory** and resets on process restart — acceptable for the single-container deployment this project targets, not suitable for horizontal scaling without moving to shared state (e.g. Redis).
- **Partial streamed AI replies are not persisted if the stream fails mid-response.** If the AI provider's connection drops after some tokens have already streamed to the browser, that partial text is not saved to the conversation history — a page reload will show no assistant message for that turn.
- **`OPENROUTER_API_KEY` must be supplied for full end-to-end chat verification.** Most of this project's chat/streaming/rate-limiting code was verified against the real route/DB/auth layers with the key left blank (confirming correct error handling: a clean 502 rather than a crash), but the actual AI-reply success path needs a real key to exercise fully.
