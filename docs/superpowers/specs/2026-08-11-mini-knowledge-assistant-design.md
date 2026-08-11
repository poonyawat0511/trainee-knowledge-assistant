# Mini Knowledge Assistant — Design Spec

Date: 2026-08-11

## Goal

Web app with login, AI chat, document upload + Q&A over uploaded content, and
token usage tracking, built with Next.js 16.3 App Router using a clean
architecture module structure.

## Requirements

- Login page with a mock user (`admin` / `admin123`)
- Chat page talking to an AI provider
- Upload page for PDF/TXT, chat can answer questions about uploaded content
- Token usage shown per message
- Runs via a single `docker compose up`
- Documentation: README.md, AI_JOURNAL.md, DECISIONS.md
- Git history should show logical, incremental commits

## Next.js 16.3 breaking changes in play

This project's `next` package (16.3.0) deprecates `middleware.js` in favor of
`proxy.js` (same behavior, renamed file/export). `params` and `searchParams`
in pages are async (`Promise`) and must be awaited. Confirmed by reading
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`
and `page.md`. The auth guard in this design uses `proxy.ts`, not
`middleware.ts`.

## Decisions from brainstorming

- **AI provider**: OpenRouter, free-tier model, called via plain `fetch`
  against the OpenAI-compatible endpoint (no heavy SDK dependency).
- **RAG**: skipped for this pass. Uploaded document text is injected into the
  chat context directly (truncated to a token budget) instead of chunking +
  embedding + vector retrieval. Documented as a trade-off in DECISIONS.md.
- **Database**: SQLite via `better-sqlite3`, no ORM — schema is small enough
  that a query builder/ORM would be overhead, and SQLite fits the
  single-container `docker compose up` requirement without an extra service.
- **Session**: JWT (`jose`) in an httpOnly + secure + sameSite=strict cookie.
  Stateless — no server-side session table needed.
- **Architecture style**: clean architecture, organized as feature modules
  (auth, documents, chat) each split into `domain` / `application` /
  `infrastructure`, rather than a flat MVC-ish layering.
- **Feature set beyond the core requirements**: Markdown rendering, streaming
  responses, conversation history save/load, Docker Compose healthcheck,
  unit tests, and rate limiting.

## Architecture

```
src/
  modules/
    auth/
      domain/            # User entity, value types — no framework imports
      application/        # LoginUseCase, VerifySessionUseCase
                           # port interfaces: UserRepository, TokenService, PasswordHasher
      infrastructure/      # SqliteUserRepository, JwtTokenService, BcryptPasswordHasher
    documents/
      domain/             # Document entity
      application/         # UploadDocumentUseCase, ExtractTextUseCase
                            # ports: DocumentRepository, TextExtractor, FileValidator
      infrastructure/       # SqliteDocumentRepository, PdfTextExtractor, LocalFileStorage
    chat/
      domain/               # Message, Conversation entities
      application/           # SendMessageUseCase, BuildContextUseCase
                              # ports: AiProvider, MessageRepository, TokenCounter
      infrastructure/         # OpenRouterAdapter, SqliteMessageRepository
  shared/
    db/                       # sqlite connection + migrations
    kernel/                   # Result type, base error classes
  app/                        # Next.js route handlers/pages = presentation layer
    login/page.tsx
    chat/page.tsx
    upload/page.tsx
    api/auth/login/route.ts
    api/auth/logout/route.ts
    api/documents/route.ts
    api/chat/route.ts
    api/health/route.ts
  proxy.ts                    # edge auth guard, calls auth.application.VerifySessionUseCase
```

Dependency rule: `domain` imports nothing project-specific. `application`
imports `domain` and port interfaces only (never a concrete infrastructure
class). `infrastructure` implements the port interfaces and is free to import
SQLite/OpenRouter/filesystem libraries. `app/` route handlers compose a
use-case with its concrete infrastructure via a small factory function (no DI
container) and act as the thin presentation layer.

## Data model (SQLite)

```
users(id, username, password_hash, created_at)
documents(id, user_id, filename, mime_type, size_bytes, content_text, created_at)
conversations(id, user_id, title, created_at)
messages(id, conversation_id, role, content, token_count, created_at)
```

No server-side session table — JWT is stateless.

## Auth flow

1. `POST /api/auth/login` `{username, password}` → `LoginUseCase` verifies
   bcrypt hash → signs JWT (`userId`, 24h expiry) → sets httpOnly + secure +
   sameSite=strict cookie.
2. `proxy.ts` matches `/chat/:path*`, `/upload/:path*`,
   `/api/documents/:path*`, `/api/chat/:path*` (login route excluded).
   Verifies JWT from cookie via `VerifySessionUseCase`; redirects to `/login`
   for page requests, returns 401 JSON for API requests.
3. `POST /api/auth/logout` clears the cookie.

## Upload flow

1. `POST /api/documents` (multipart) → validate mime type (pdf/txt only),
   size limit (10MB), sanitize filename (strip path traversal, store under a
   generated UUID name).
2. `ExtractTextUseCase`: `pdf-parse` for PDF, direct read for TXT. Extracted
   text stored as `content_text` in SQLite; raw file is not kept permanently
   (or stored under a sanitized path if kept, to minimize attack surface).
3. Response: document id, filename, extracted character count.

## Chat flow

1. `POST /api/chat` `{conversationId?, message, documentId?}`.
2. If `documentId` present, `BuildContextUseCase` fetches `content_text`,
   truncates to a token budget (approx. 4 chars/token), and prepends it as
   system context.
3. `SendMessageUseCase` calls `OpenRouterAdapter` with a request timeout
   (`AbortController`, ~30s) and one retry on network failure; returns a
   clear error to the user on failure rather than hanging.
4. Message (role, content, token_count) persisted to `messages`. Response
   includes per-message token usage.
5. Streaming: route handler returns a `ReadableStream` (SSE-style),
   OpenRouter called with `stream: true`; client reads chunks incrementally.

## Token usage

OpenRouter response includes `usage.total_tokens` per call, stored on the
message row. Session total is a SQL `SUM` over the conversation's messages,
shown in the UI.

## Feature implementation notes

- **Markdown rendering**: `react-markdown` + `remark-gfm` in the chat message
  component.
- **Streaming**: as above.
- **Conversation history**: sidebar lists `conversations` for the user;
  selecting one loads its `messages`; "New chat" starts a fresh conversation.
- **Docker Compose + Healthcheck**: single service (Next.js standalone
  build), `GET /api/health` polled every 30s by the compose healthcheck.
- **Unit tests**: `vitest`, scoped to the `application/` layer (use-cases)
  with mocked ports — fast, no real DB/network needed.
- **Rate limiting**: in-memory token bucket keyed by `userId` on
  `/api/chat` (e.g. 10 req/min). Acceptable for a single-container app; no
  Redis dependency.

## Security checklist

- bcrypt password hashing
- httpOnly + secure JWT cookie (no token in localStorage)
- zod schema validation on every route's input
- upload validation: mime type, size limit, filename/path sanitization
- CORS: same-origin only (frontend and backend are one app)
- no hardcoded secrets — `OPENROUTER_API_KEY`, `JWT_SECRET` via `.env`
  (not committed; `.env.example` provided)

## Docker

Multi-stage `Dockerfile` (build stage → Next.js standalone runner).
`docker-compose.yml` runs the single service, mounts a volume so the SQLite
file persists across restarts, and reads `OPENROUTER_API_KEY` / `JWT_SECRET`
from `.env`.

## Documentation deliverables

- `README.md`: tech stack, `docker compose up` setup, features-done
  checklist, architecture description (clean architecture modules), known
  issues.
- `AI_JOURNAL.md`: logged per session during actual implementation (not
  backfilled).
- `DECISIONS.md`: three decisions — (1) SQLite over PostgreSQL, (2) skipping
  RAG in favor of full-context injection, (3) clean architecture module
  structure over a flat layering.

## Testing strategy

Unit tests target `application/` use-cases per module with mocked port
interfaces (`UserRepository`, `AiProvider`, `DocumentRepository`, etc.) —
this is where coverage is gained without needing a real database or network
call in CI.

## Out of scope for this pass

- RAG / vector DB (explicitly skipped, see Decisions)
- Citation of source spans within documents (depends on chunking, skipped
  alongside RAG)
- Multi-user registration flow (single mock user only)
