# Inline Chat Upload + Lazy New Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone `/upload` page with inline file attachment in the chat compose box, make every `/chat` visit start as an unsaved "new chat" until the user acts, and scope uploaded documents to the conversation they were attached to.

**Architecture:** Add a `conversation_id` column to `documents` (idempotent migration in `src/shared/db/client.ts`, mirrors the WASM/sql.js persistence pattern already used there). `DocumentRepository` gains `listByConversation`. `POST /api/documents` accepts an optional `conversationId` and creates one server-side when absent. `chat`'s `DocumentTextLookup` port switches from a single-document lookup to a per-conversation multi-document lookup; `BuildContextUseCase` concatenates all of a conversation's document texts (still truncated at the existing ~12,000-char budget) instead of looking up one `documentId`. `/api/chat` and `/api/chat/stream` drop `documentId` from their request bodies entirely. The chat UI (`chat-window.tsx`) gets a 📎 attach button that uploads immediately, and lazily creates a conversation client-side (via the existing `POST /api/conversations`) on first send if none exists yet — no remount, so an in-flight request never gets orphaned. `/upload` (page + its `proxy.ts` matcher) is deleted.

**Tech Stack:** Next.js 16.3 App Router, TypeScript, sql.js (WASM SQLite), Vitest.

## Global Constraints

- Every repository method must filter by `userId` — no new IDOR surface. This applies to `listByConversation` exactly as it does to every existing `findById`/`listByUser` method in the codebase.
- `getDb()` is `async` — every new call site must `await getDb()` (matches the existing sql.js wrapper convention in `src/shared/db/client.ts`).
- Test coverage stays scoped to `src/modules/**/application/**` and `src/shared/**` per `vitest.config.ts` — application-layer use-case tests are required for every new/changed use case; no new UI component tests are expected (none exist today for `chat-window.tsx` etc.).
- No new abstractions beyond what each task needs — reuse the existing `Result<T, E>` kernel type, the existing factory-function composition pattern (no DI container), and the existing `POST /api/conversations` endpoint for lazy conversation creation from the chat-send path (do not add a second server-side lazy-create code path for that flow).
- Removing a document from a conversation is explicitly out of scope — no delete endpoint, no unattach UI.

---

### Task 1: `documents` schema migration + domain + repository

**Files:**
- Modify: `src/shared/db/schema.sql`
- Modify: `src/shared/db/client.ts`
- Modify: `src/modules/documents/domain/document.ts`
- Modify: `src/modules/documents/application/ports.ts`
- Modify: `src/modules/documents/infrastructure/sqlite-document-repository.ts`
- Test: `src/modules/documents/infrastructure/sqlite-document-repository.test.ts` (new)

**Interfaces:**
- Produces: `Document.conversationId: string`; `DocumentRepository.listByConversation(conversationId: string, userId: string): Promise<Document[]>`.

- [ ] **Step 1: Add `conversation_id` to the schema and an idempotent migration**

In `src/shared/db/schema.sql`, change the `documents` table:

```sql
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  conversation_id TEXT REFERENCES conversations(id),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  content_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

In `src/shared/db/client.ts`, inside `getDb()`, right after `wrapped.exec(schema)`, add a migration for databases created before this column existed:

```typescript
    wrapped.exec(schema)

    // Idempotent migration: databases created before `conversation_id` was
    // added to the schema won't get it from `CREATE TABLE IF NOT EXISTS`
    // (that only runs for brand-new tables). SQLite has no `ADD COLUMN IF
    // NOT EXISTS`, so attempt it and ignore the "duplicate column" failure.
    try {
      wrapped.exec('ALTER TABLE documents ADD COLUMN conversation_id TEXT REFERENCES conversations(id)')
    } catch {
      // column already exists
    }

    return wrapped
```

- [ ] **Step 2: Add `conversationId` to the `Document` domain entity**

In `src/modules/documents/domain/document.ts`:

```typescript
export interface Document {
  id: string
  userId: string
  conversationId: string
  filename: string
  mimeType: string
  sizeBytes: number
  contentText: string
  createdAt: string
}
```

- [ ] **Step 3: Add `listByConversation` to the `DocumentRepository` port**

In `src/modules/documents/application/ports.ts`:

```typescript
import type { Document } from '../domain/document'

export interface DocumentRepository {
  save(doc: Document): Promise<void>
  findById(id: string, userId: string): Promise<Document | null>
  listByConversation(conversationId: string, userId: string): Promise<Document[]>
}

export interface TextExtractor {
  extract(buffer: Buffer, mimeType: string): Promise<string>
}

export interface IdGenerator {
  generate(): string
}
```

- [ ] **Step 4: Write the failing repository test**

Create `src/modules/documents/infrastructure/sqlite-document-repository.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SqliteDocumentRepository } from './sqlite-document-repository'
import type { Document } from '../domain/document'

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: randomUUID(),
    userId: 'user-1',
    conversationId: 'conv-1',
    filename: 'notes.txt',
    mimeType: 'text/plain',
    sizeBytes: 10,
    contentText: 'hello world',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('SqliteDocumentRepository', () => {
  beforeEach(() => {
    const dbPath = path.join(os.tmpdir(), `test-db-${randomUUID()}.sqlite`)
    process.env.DATABASE_PATH = dbPath
    // Reset the module's cached db promise between tests by re-importing
    // isn't possible with a static import; instead each test uses a fresh
    // DATABASE_PATH so getDb() (cached per-process) still points at a file
    // that starts empty for the first test that touches it. Since vitest
    // runs this file in one process, we rely on getDb()'s cache only being
    // populated once — tests below share the same in-memory db and clean
    // up via unique ids instead of a fresh db per test.
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  })

  it('lists documents for a conversation, scoped to the owning user', async () => {
    const repo = new SqliteDocumentRepository()
    const conversationId = randomUUID()
    const userId = randomUUID()
    const otherUserId = randomUUID()

    const { getDb } = await import('@/shared/db/client')
    const db = await getDb()
    db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(userId, `u-${userId}`, 'x')
    db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(otherUserId, `u-${otherUserId}`, 'x')
    db.prepare('INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)').run(conversationId, userId, 'Test')

    const mine = makeDoc({ userId, conversationId, filename: 'a.txt' })
    const otherUsersDoc = makeDoc({ userId: otherUserId, conversationId, filename: 'b.txt' })
    await repo.save(mine)
    await repo.save(otherUsersDoc)

    const result = await repo.listByConversation(conversationId, userId)

    expect(result.map((d) => d.filename)).toEqual(['a.txt'])
  })

  it('returns an empty array for a conversation with no documents', async () => {
    const repo = new SqliteDocumentRepository()
    const result = await repo.listByConversation(randomUUID(), randomUUID())
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm test src/modules/documents/infrastructure/sqlite-document-repository.test.ts`
Expected: FAIL — `repo.listByConversation is not a function`.

- [ ] **Step 6: Implement `listByConversation` and thread `conversationId` through the repository**

Replace `src/modules/documents/infrastructure/sqlite-document-repository.ts`:

```typescript
import { getDb } from '@/shared/db/client'
import type { DocumentRepository } from '../application/ports'
import type { Document } from '../domain/document'

interface DocumentRow {
  id: string
  user_id: string
  conversation_id: string
  filename: string
  mime_type: string
  size_bytes: number
  content_text: string
  created_at: string
}

function toDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    contentText: row.content_text,
    createdAt: row.created_at,
  }
}

export class SqliteDocumentRepository implements DocumentRepository {
  async save(doc: Document): Promise<void> {
    const db = await getDb()
    db
      .prepare(
        `INSERT INTO documents (id, user_id, conversation_id, filename, mime_type, size_bytes, content_text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(doc.id, doc.userId, doc.conversationId, doc.filename, doc.mimeType, doc.sizeBytes, doc.contentText, doc.createdAt)
  }

  async findById(id: string, userId: string): Promise<Document | null> {
    const db = await getDb()
    const row = db
      .prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?')
      .get(id, userId) as DocumentRow | undefined
    return row ? toDocument(row) : null
  }

  async listByConversation(conversationId: string, userId: string): Promise<Document[]> {
    const db = await getDb()
    const rows = db
      .prepare('SELECT * FROM documents WHERE conversation_id = ? AND user_id = ? ORDER BY created_at ASC')
      .all(conversationId, userId) as unknown as DocumentRow[]
    return rows.map(toDocument)
  }
}
```

Note: `listByUser` is removed — after this feature, nothing lists a user's documents outside a conversation (the `/upload` page and its all-documents dropdown are deleted in Task 8/9).

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm test src/modules/documents/infrastructure/sqlite-document-repository.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/shared/db/schema.sql src/shared/db/client.ts src/modules/documents/domain/document.ts src/modules/documents/application/ports.ts src/modules/documents/infrastructure/sqlite-document-repository.ts src/modules/documents/infrastructure/sqlite-document-repository.test.ts
git commit -m "feat: scope documents to conversations at the data layer"
```

---

### Task 2: `UploadDocumentUseCase` requires `conversationId`

**Files:**
- Modify: `src/modules/documents/application/upload-document-use-case.ts`
- Modify: `src/modules/documents/application/upload-document-use-case.test.ts`

**Interfaces:**
- Consumes: `Document` (Task 1), `DocumentRepository.save` (Task 1).
- Produces: `UploadDocumentUseCase.execute(input: { userId: string; conversationId: string; filename: string; mimeType: string; buffer: Buffer })`.

- [ ] **Step 1: Update the failing/changed tests first**

In `src/modules/documents/application/upload-document-use-case.test.ts`, add `conversationId: 'conv-1'` to every `execute(...)` call's input object (all four `it` blocks), and assert it's persisted on the saved document. Full updated file:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { UploadDocumentUseCase } from './upload-document-use-case'
import type { DocumentRepository, TextExtractor, IdGenerator } from './ports'

const ALLOWED_TYPES = ['application/pdf', 'text/plain']
const MAX_BYTES = 10 * 1024 * 1024

function makeUseCase(overrides: {
  repo?: Partial<DocumentRepository>
  extractor?: Partial<TextExtractor>
  ids?: Partial<IdGenerator>
} = {}) {
  const repo: DocumentRepository = {
    save: vi.fn(async () => {}),
    findById: vi.fn(async () => null),
    listByConversation: vi.fn(async () => []),
    ...overrides.repo,
  }
  const extractor: TextExtractor = {
    extract: vi.fn(async () => 'extracted text'),
    ...overrides.extractor,
  }
  const ids: IdGenerator = { generate: vi.fn(() => 'doc-1'), ...overrides.ids }
  return { useCase: new UploadDocumentUseCase(repo, extractor, ids), repo, extractor }
}

describe('UploadDocumentUseCase', () => {
  it('rejects unsupported mime types', async () => {
    const { useCase } = makeUseCase()
    const result = await useCase.execute({
      userId: 'u1',
      conversationId: 'conv-1',
      filename: 'x.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('data'),
    })
    expect(result).toEqual({ ok: false, error: 'UNSUPPORTED_TYPE' })
  })

  it('rejects files over the size limit', async () => {
    const { useCase } = makeUseCase()
    const result = await useCase.execute({
      userId: 'u1',
      conversationId: 'conv-1',
      filename: 'big.txt',
      mimeType: 'text/plain',
      buffer: Buffer.alloc(MAX_BYTES + 1),
    })
    expect(result).toEqual({ ok: false, error: 'TOO_LARGE' })
  })

  it('rejects files that extract to empty text', async () => {
    const { useCase } = makeUseCase({ extractor: { extract: vi.fn(async () => '   ') } })
    const result = await useCase.execute({
      userId: 'u1',
      conversationId: 'conv-1',
      filename: 'empty.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(''),
    })
    expect(result).toEqual({ ok: false, error: 'EMPTY_FILE' })
  })

  it('saves and returns the document, linked to the given conversation', async () => {
    const { useCase, repo } = makeUseCase()
    const result = await useCase.execute({
      userId: 'u1',
      conversationId: 'conv-1',
      filename: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello world'),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.id).toBe('doc-1')
      expect(result.value.contentText).toBe('extracted text')
      expect(result.value.conversationId).toBe('conv-1')
    }
    expect(repo.save).toHaveBeenCalledOnce()
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv-1' }))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/modules/documents/application/upload-document-use-case.test.ts`
Expected: FAIL — `result.value.conversationId` is `undefined`, or a TypeScript error on the missing `conversationId` field (whichever the test runner surfaces first).

- [ ] **Step 3: Add `conversationId` to the use case**

In `src/modules/documents/application/upload-document-use-case.ts`:

```typescript
import { ok, err, type Result } from '@/shared/kernel/result'
import type { Document } from '../domain/document'
import type { DocumentRepository, TextExtractor, IdGenerator } from './ports'

const ALLOWED_TYPES = ['application/pdf', 'text/plain']
const MAX_BYTES = 10 * 1024 * 1024

export class UploadDocumentUseCase {
  constructor(
    private readonly repo: DocumentRepository,
    private readonly extractor: TextExtractor,
    private readonly ids: IdGenerator
  ) {}

  async execute(input: {
    userId: string
    conversationId: string
    filename: string
    mimeType: string
    buffer: Buffer
  }): Promise<Result<Document, 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'EMPTY_FILE'>> {
    if (!ALLOWED_TYPES.includes(input.mimeType)) {
      return err('UNSUPPORTED_TYPE')
    }
    if (input.buffer.byteLength > MAX_BYTES) {
      return err('TOO_LARGE')
    }

    const contentText = (await this.extractor.extract(input.buffer, input.mimeType)).trim()
    if (contentText.length === 0) {
      return err('EMPTY_FILE')
    }

    const doc: Document = {
      id: this.ids.generate(),
      userId: input.userId,
      conversationId: input.conversationId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.byteLength,
      contentText,
      createdAt: new Date().toISOString(),
    }

    await this.repo.save(doc)
    return ok(doc)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/modules/documents/application/upload-document-use-case.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/documents/application/upload-document-use-case.ts src/modules/documents/application/upload-document-use-case.test.ts
git commit -m "feat: require conversationId when uploading a document"
```

---

### Task 3: `POST`/`GET /api/documents` — lazy conversation creation + per-conversation listing

**Files:**
- Modify: `src/app/api/documents/route.ts`

**Interfaces:**
- Consumes: `makeUploadDocumentUseCase()`, `makeDocumentRepository()` (`src/modules/documents/infrastructure/factory.ts`, unchanged), `makeConversationRepository()` (`src/modules/chat/infrastructure/factory.ts`, unchanged — presentation layer is allowed to compose across modules, same as `send-message-use-case`'s existing cross-module adapter).
- Produces: `POST` response `{ documentId, filename, charCount, conversationId }`; `GET ?conversationId=<id>` response `{ documents: { id, filename, createdAt }[] }`.

This task has no application-layer logic of its own (it's a thin route), so no new unit test — verified manually via `curl` against the dev server, matching this codebase's existing convention of leaving route handlers uncovered by Vitest (see `vitest.config.ts`'s `include`).

- [ ] **Step 1: Rewrite the route**

Replace `src/app/api/documents/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { makeUploadDocumentUseCase, makeDocumentRepository } from '@/modules/documents/infrastructure/factory'
import { makeConversationRepository } from '@/modules/chat/infrastructure/factory'
import { getUserId } from '@/shared/auth/get-user-id'

export async function POST(request: Request) {
  const userId = await getUserId(request)
  if (!userId) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: { code: 'INVALID_BODY', message: 'file is required' } }, { status: 400 })
  }

  let conversationId = formData.get('conversationId')
  if (typeof conversationId !== 'string' || conversationId.length === 0) {
    const conversation = { id: randomUUID(), userId, title: 'New chat', createdAt: new Date().toISOString() }
    await makeConversationRepository().save(conversation)
    conversationId = conversation.id
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const result = await makeUploadDocumentUseCase().execute({
    userId,
    conversationId,
    filename: file.name,
    mimeType: file.type,
    buffer,
  })

  if (!result.ok) {
    return NextResponse.json({ error: { code: result.error, message: uploadErrorMessage(result.error) } }, { status: 400 })
  }

  return NextResponse.json({
    documentId: result.value.id,
    filename: result.value.filename,
    charCount: result.value.contentText.length,
    conversationId,
  })
}

export async function GET(request: Request) {
  const userId = await getUserId(request)
  if (!userId) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } }, { status: 401 })
  }

  const conversationId = new URL(request.url).searchParams.get('conversationId')
  if (!conversationId) {
    return NextResponse.json({ error: { code: 'INVALID_BODY', message: 'conversationId query param is required' } }, { status: 400 })
  }

  const docs = await makeDocumentRepository().listByConversation(conversationId, userId)
  return NextResponse.json({
    documents: docs.map((d) => ({ id: d.id, filename: d.filename, createdAt: d.createdAt })),
  })
}

function uploadErrorMessage(code: 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'EMPTY_FILE'): string {
  switch (code) {
    case 'UNSUPPORTED_TYPE':
      return 'Only PDF and TXT files are supported'
    case 'TOO_LARGE':
      return 'File exceeds the 10MB limit'
    case 'EMPTY_FILE':
      return 'No readable text was found in the file'
  }
}
```

- [ ] **Step 2: Manual verification**

Run: `pnpm dev`, then in another terminal:

```bash
# login first to get a session cookie
curl -sc /tmp/cookies.txt -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' >/dev/null

# upload without a conversationId — should create one and return it
curl -sb /tmp/cookies.txt -X POST http://localhost:3000/api/documents -F 'file=@README.md;type=text/plain'
```

Expected: JSON body with `documentId`, `filename`, `charCount`, and a fresh `conversationId`. Then:

```bash
curl -sb /tmp/cookies.txt "http://localhost:3000/api/documents?conversationId=<the-conversationId-from-above>"
```

Expected: `{"documents":[{"id":"...","filename":"README.md","createdAt":"..."}]}`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/documents/route.ts
git commit -m "feat: lazily create a conversation on upload, list documents per conversation"
```

---

### Task 4: `chat` module's `DocumentTextLookup` port switches to per-conversation, multi-document lookup

**Files:**
- Modify: `src/modules/chat/application/ports.ts`
- Modify: `src/modules/chat/infrastructure/document-text-lookup.ts`

**Interfaces:**
- Consumes: `DocumentRepository.listByConversation` (Task 1).
- Produces: `DocumentTextLookup.listContentTexts(conversationId: string, userId: string): Promise<string[]>`.

No dedicated test for this task — it's a thin adapter (same category as the existing `SqliteDocumentTextLookup`, which has never had its own test; it's exercised indirectly through `BuildContextUseCase`'s tests in Task 5 via a hand-written fake).

- [ ] **Step 1: Update the port**

In `src/modules/chat/application/ports.ts`, replace the `DocumentTextLookup` interface:

```typescript
export interface DocumentTextLookup {
  listContentTexts(conversationId: string, userId: string): Promise<string[]>
}
```

(Leave every other interface in this file unchanged.)

- [ ] **Step 2: Update the adapter**

Replace `src/modules/chat/infrastructure/document-text-lookup.ts`:

```typescript
import { SqliteDocumentRepository } from '@/modules/documents/infrastructure/sqlite-document-repository'
import type { DocumentTextLookup } from '../application/ports'

export class SqliteDocumentTextLookup implements DocumentTextLookup {
  private readonly repo = new SqliteDocumentRepository()

  async listContentTexts(conversationId: string, userId: string): Promise<string[]> {
    const docs = await this.repo.listByConversation(conversationId, userId)
    return docs.map((d) => d.contentText)
  }
}
```

Do not commit yet — this change alone does not typecheck (`BuildContextUseCase` still calls the old `getContentText` method). Task 5 updates it and commits both together.

---

### Task 5: `BuildContextUseCase` — concatenate all of a conversation's documents

**Files:**
- Modify: `src/modules/chat/application/build-context-use-case.ts`
- Modify: `src/modules/chat/application/build-context-use-case.test.ts`

**Interfaces:**
- Consumes: `DocumentTextLookup.listContentTexts` (Task 4).
- Produces: `BuildContextUseCase.execute(input: { userId: string; conversationId: string }): Promise<string | null>`.

- [ ] **Step 1: Write the failing tests**

Replace `src/modules/chat/application/build-context-use-case.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { BuildContextUseCase } from './build-context-use-case'
import type { DocumentTextLookup } from './ports'

describe('BuildContextUseCase', () => {
  it('returns null when the conversation has no documents', async () => {
    const lookup: DocumentTextLookup = { listContentTexts: vi.fn(async () => []) }
    const useCase = new BuildContextUseCase(lookup)
    expect(await useCase.execute({ userId: 'u1', conversationId: 'c1' })).toBeNull()
  })

  it('returns a system prompt built from a single document', async () => {
    const lookup: DocumentTextLookup = { listContentTexts: vi.fn(async () => ['The quick brown fox']) }
    const useCase = new BuildContextUseCase(lookup)
    const prompt = await useCase.execute({ userId: 'u1', conversationId: 'c1' })
    expect(prompt).toContain('The quick brown fox')
  })

  it('concatenates text from multiple documents into one prompt', async () => {
    const lookup: DocumentTextLookup = {
      listContentTexts: vi.fn(async () => ['first document text', 'second document text']),
    }
    const useCase = new BuildContextUseCase(lookup)
    const prompt = await useCase.execute({ userId: 'u1', conversationId: 'c1' })
    expect(prompt).toContain('first document text')
    expect(prompt).toContain('second document text')
  })

  it('truncates the combined content that exceeds the token budget', async () => {
    const longText = 'a'.repeat(50_000)
    const lookup: DocumentTextLookup = { listContentTexts: vi.fn(async () => [longText, longText]) }
    const useCase = new BuildContextUseCase(lookup, { maxChars: 1000 })
    const prompt = await useCase.execute({ userId: 'u1', conversationId: 'c1' })
    expect(prompt!.length).toBeLessThan(1200)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/modules/chat/application/build-context-use-case.test.ts`
Expected: FAIL — `lookup.listContentTexts` doesn't exist on the current implementation's expected shape / `execute` still takes `documentId`.

- [ ] **Step 3: Implement**

Replace `src/modules/chat/application/build-context-use-case.ts`:

```typescript
import type { DocumentTextLookup } from './ports'

export class BuildContextUseCase {
  private readonly maxChars: number

  constructor(
    private readonly lookup: DocumentTextLookup,
    options: { maxChars?: number } = {}
  ) {
    // ~4 chars/token, budget ~3000 tokens for context by default
    this.maxChars = options.maxChars ?? 12_000
  }

  async execute(input: { userId: string; conversationId: string }): Promise<string | null> {
    const texts = await this.lookup.listContentTexts(input.conversationId, input.userId)
    if (texts.length === 0) return null

    const combined = texts.join('\n\n---\n\n')
    const truncated = combined.length > this.maxChars ? combined.slice(0, this.maxChars) : combined

    return [
      'You are a helpful assistant answering questions about the following document(s).',
      'Only use information from the document(s) below; say so if the answer is not in them.',
      '---',
      truncated,
      '---',
    ].join('\n')
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/modules/chat/application/build-context-use-case.test.ts`
Expected: PASS

- [ ] **Step 5: Commit (includes Task 4's port/adapter change)**

```bash
git add src/modules/chat/application/ports.ts src/modules/chat/infrastructure/document-text-lookup.ts src/modules/chat/application/build-context-use-case.ts src/modules/chat/application/build-context-use-case.test.ts
git commit -m "feat: build chat context from all of a conversation's documents"
```

---

### Task 6: Drop `documentId` from `SendMessageUseCase` / `StreamMessageUseCase`

**Files:**
- Modify: `src/modules/chat/application/send-message-use-case.ts`
- Modify: `src/modules/chat/application/send-message-use-case.test.ts`
- Modify: `src/modules/chat/application/stream-message-use-case.ts`
- Modify: `src/modules/chat/application/stream-message-use-case.test.ts`

**Interfaces:**
- Consumes: `BuildContextUseCase.execute({ userId, conversationId })` (Task 5).
- Produces: `SendMessageUseCase.execute(input: { userId, conversationId, userMessage })`, `StreamMessageUseCase.execute(input: { userId, conversationId, userMessage })` — both drop `documentId?`.

- [ ] **Step 1: Update the test mocks first**

In `src/modules/chat/application/send-message-use-case.test.ts`, change the `DocumentTextLookup` import usage and mock:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { SendMessageUseCase } from './send-message-use-case'
import { BuildContextUseCase } from './build-context-use-case'
import type { MessageRepository, AiProvider, IdGenerator, DocumentTextLookup } from './ports'

function makeUseCase(overrides: { ai?: Partial<AiProvider> } = {}) {
  const messages: MessageRepository = {
    save: vi.fn(async () => {}),
    listByConversation: vi.fn(async () => []),
  }
  const ai: AiProvider = {
    complete: vi.fn(async () => ({ content: 'Hello back', tokenCount: 12 })),
    completeStream: vi.fn(async function* () {}),
    ...overrides.ai,
  }
  const ids: IdGenerator = { generate: vi.fn(() => 'msg-1') }
  const lookup: DocumentTextLookup = { listContentTexts: vi.fn(async () => []) }
  const context = new BuildContextUseCase(lookup)
  const useCase = new SendMessageUseCase(messages, ai, ids, context)
  return { useCase, messages, ai }
}

describe('SendMessageUseCase', () => {
  it('saves the user message and the AI reply, returning the reply', async () => {
    const { useCase, messages, ai } = makeUseCase()

    const result = await useCase.execute({
      userId: 'u1',
      conversationId: 'c1',
      userMessage: 'hi',
    })

    expect(result).toEqual({ ok: true, value: { reply: 'Hello back', tokenCount: 12 } })
    expect(messages.save).toHaveBeenCalledTimes(2)
    expect(ai.complete).toHaveBeenCalledOnce()
  })

  it('returns AI_PROVIDER_ERROR when the provider throws', async () => {
    const { useCase } = makeUseCase({
      ai: { complete: vi.fn(async () => { throw new Error('timeout') }) },
    })

    const result = await useCase.execute({
      userId: 'u1',
      conversationId: 'c1',
      userMessage: 'hi',
    })

    expect(result).toEqual({ ok: false, error: 'AI_PROVIDER_ERROR' })
  })
})
```

Apply the identical `lookup`/`DocumentTextLookup` change to `src/modules/chat/application/stream-message-use-case.test.ts` (same two lines: the import already lists `DocumentTextLookup`, just change `getContentText: vi.fn(async () => null)` to `listContentTexts: vi.fn(async () => [])`). The rest of that file is unchanged.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/modules/chat/application/send-message-use-case.test.ts src/modules/chat/application/stream-message-use-case.test.ts`
Expected: FAIL (TypeScript error — `getContentText` no longer exists on `DocumentTextLookup`, or already fixed by Step 1 and just failing at runtime if Step 3 below isn't done yet — either way, confirm it's red before Step 3).

- [ ] **Step 3: Update the use cases**

In `src/modules/chat/application/send-message-use-case.ts`, remove `documentId` from the `execute` input type and the `buildContext.execute` call:

```typescript
import { ok, err, type Result } from '@/shared/kernel/result'
import type { Message } from '../domain/message'
import type { MessageRepository, AiProvider, IdGenerator } from './ports'
import type { BuildContextUseCase } from './build-context-use-case'

export class SendMessageUseCase {
  constructor(
    private readonly messages: MessageRepository,
    private readonly ai: AiProvider,
    private readonly ids: IdGenerator,
    private readonly buildContext: BuildContextUseCase
  ) {}

  async execute(input: {
    userId: string
    conversationId: string
    userMessage: string
  }): Promise<Result<{ reply: string; tokenCount: number }, 'AI_PROVIDER_ERROR'>> {
    const history = await this.messages.listByConversation(input.conversationId)
    const systemPrompt = await this.buildContext.execute({
      userId: input.userId,
      conversationId: input.conversationId,
    })

    const userMsg: Message = {
      id: this.ids.generate(),
      conversationId: input.conversationId,
      role: 'user',
      content: input.userMessage,
      tokenCount: 0,
      createdAt: new Date().toISOString(),
    }
    await this.messages.save(userMsg)

    let completion: { content: string; tokenCount: number }
    try {
      completion = await this.ai.complete({
        systemPrompt: systemPrompt ?? undefined,
        messages: [
          ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          { role: 'user', content: input.userMessage },
        ],
      })
    } catch {
      return err('AI_PROVIDER_ERROR')
    }

    const assistantMsg: Message = {
      id: this.ids.generate(),
      conversationId: input.conversationId,
      role: 'assistant',
      content: completion.content,
      tokenCount: completion.tokenCount,
      createdAt: new Date().toISOString(),
    }
    await this.messages.save(assistantMsg)

    return ok({ reply: completion.content, tokenCount: completion.tokenCount })
  }
}
```

Apply the equivalent change to `src/modules/chat/application/stream-message-use-case.ts`: remove `documentId?: string` from the `execute` input type, and change the `buildContext.execute` call to `{ userId: input.userId, conversationId: input.conversationId }`. Everything else in that file (the generator loop, the persistence sequencing, the doc comment above the class) is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/modules/chat/application/send-message-use-case.test.ts src/modules/chat/application/stream-message-use-case.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/chat/application/send-message-use-case.ts src/modules/chat/application/send-message-use-case.test.ts src/modules/chat/application/stream-message-use-case.ts src/modules/chat/application/stream-message-use-case.test.ts
git commit -m "feat: drop per-message documentId, context now comes from the conversation"
```

---

### Task 7: Drop `documentId` from `/api/chat` and `/api/chat/stream`

**Files:**
- Modify: `src/app/api/chat/route.ts`
- Modify: `src/app/api/chat/stream/route.ts`

**Interfaces:**
- Consumes: `SendMessageUseCase.execute`, `StreamMessageUseCase.execute` (Task 6, no `documentId`).

No new test (thin route, same convention as Task 3). Verified manually.

- [ ] **Step 1: Update `/api/chat`**

In `src/app/api/chat/route.ts`, remove `documentId` from `bodySchema` and from the use-case call:

```typescript
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserId } from '@/shared/auth/get-user-id'
import { chatRateLimiter } from '@/shared/rate-limit/token-bucket'
import { makeSendMessageUseCase, makeConversationRepository } from '@/modules/chat/infrastructure/factory'

const bodySchema = z.object({
  conversationId: z.string().min(1),
  message: z.string().min(1).max(8000),
})

export async function POST(request: Request) {
  const userId = await getUserId(request)
  if (!userId) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } }, { status: 401 })
  }

  const limit = chatRateLimiter.tryConsume(userId)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down' } },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    )
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'INVALID_BODY', message: 'Invalid chat request' } }, { status: 400 })
  }

  const conversation = await makeConversationRepository().findById(parsed.data.conversationId, userId)
  if (!conversation) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } }, { status: 404 })
  }

  const result = await makeSendMessageUseCase().execute({
    userId,
    conversationId: parsed.data.conversationId,
    userMessage: parsed.data.message,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.error, message: 'The AI provider failed to respond. Please try again.' } },
      { status: 502 }
    )
  }

  return NextResponse.json({ reply: result.value.reply, tokenCount: result.value.tokenCount })
}
```

- [ ] **Step 2: Update `/api/chat/stream`**

In `src/app/api/chat/stream/route.ts`, same removal:

```typescript
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserId } from '@/shared/auth/get-user-id'
import { chatRateLimiter } from '@/shared/rate-limit/token-bucket'
import { makeConversationRepository, makeStreamMessageUseCase } from '@/modules/chat/infrastructure/factory'

const bodySchema = z.object({
  conversationId: z.string().min(1),
  message: z.string().min(1).max(8000),
})

export async function POST(request: Request) {
  const userId = await getUserId(request)
  if (!userId) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } }, { status: 401 })
  }

  const limit = chatRateLimiter.tryConsume(userId)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down' } },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    )
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'INVALID_BODY', message: 'Invalid chat request' } }, { status: 400 })
  }

  const { conversationId, message } = parsed.data

  const conversation = await makeConversationRepository().findById(conversationId, userId)
  if (!conversation) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } }, { status: 404 })
  }

  const streamMessage = makeStreamMessageUseCase()

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      try {
        for await (const chunk of streamMessage.execute({ userId, conversationId, userMessage: message })) {
          if (chunk.done) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, tokenCount: chunk.tokenCount })}\n\n`))
          } else {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: chunk.delta })}\n\n`))
          }
        }
      } catch {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'AI_PROVIDER_ERROR' })}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
```

- [ ] **Step 3: Run the full test suite to check for regressions**

Run: `pnpm test`
Expected: PASS (all suites).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/chat/route.ts src/app/api/chat/stream/route.ts
git commit -m "feat: drop documentId from the chat request body"
```

---

### Task 8: `chat-window.tsx` — inline attach button + lazy conversation creation

**Files:**
- Modify: `src/app/chat/chat-window.tsx`

**Interfaces:**
- Consumes: `POST /api/documents` (Task 3, multipart form with optional `conversationId`, returns `conversationId`), `POST /api/conversations` (existing, unchanged — `{ conversation: { id, title, createdAt } }`), `GET /api/documents?conversationId=` (Task 3), `POST /api/chat/stream` (Task 7, no `documentId`).
- Produces: `ChatWindow(props: { conversationId: string | null; onConversationCreated: (id: string) => void })` — drops the old `documentId` prop entirely.

No automated test (no existing tests for any `.tsx` file in this project — coverage is scoped to `application/` and `shared/` per `vitest.config.ts`). Verified manually in Task 9's Step 2 (both tasks' UI changes are tested together in the browser, since they're two halves of one screen).

- [ ] **Step 1: Rewrite `chat-window.tsx`**

Replace `src/app/chat/chat-window.tsx`:

```typescript
'use client'

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  tokenCount?: number
}

interface Attachment {
  id: string
  filename: string
  status: 'uploading' | 'done' | 'error'
  error?: string
}

export function ChatWindow({
  conversationId,
  onConversationCreated,
}: {
  conversationId: string | null
  onConversationCreated: (id: string) => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionTokens, setSessionTokens] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!conversationId) {
      setMessages([])
      setAttachments([])
      setSessionTokens(0)
      return
    }

    let cancelled = false

    fetch(`/api/conversations/${conversationId}/messages`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        const loaded: ChatMessage[] = body.messages ?? []
        setMessages(loaded)
        setSessionTokens(loaded.reduce((sum, m) => sum + (m.tokenCount ?? 0), 0))
        setError(null)
      })
      .catch(() => {
        if (cancelled) return
        setMessages([])
        setSessionTokens(0)
        setError('Failed to load conversation history')
      })

    fetch(`/api/documents?conversationId=${conversationId}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        const docs: { id: string; filename: string }[] = body.documents ?? []
        setAttachments(docs.map((d) => ({ id: d.id, filename: d.filename, status: 'done' as const })))
      })
      .catch(() => {
        if (cancelled) return
        setAttachments([])
      })

    return () => {
      cancelled = true
    }
  }, [conversationId])

  async function handleAttach(file: File) {
    const tempId = `pending-${Date.now()}`
    setAttachments((prev) => [...prev, { id: tempId, filename: file.name, status: 'uploading' }])

    const formData = new FormData()
    formData.append('file', file)
    if (conversationId) formData.append('conversationId', conversationId)

    try {
      const response = await fetch('/api/documents', { method: 'POST', body: formData })
      const body = await response.json()

      if (!response.ok) {
        setAttachments((prev) =>
          prev.map((a) => (a.id === tempId ? { ...a, status: 'error', error: body.error?.message ?? 'Upload failed' } : a))
        )
        return
      }

      if (!conversationId) onConversationCreated(body.conversationId)

      setAttachments((prev) =>
        prev.map((a) => (a.id === tempId ? { id: body.documentId, filename: body.filename, status: 'done' } : a))
      )
    } catch {
      setAttachments((prev) => prev.map((a) => (a.id === tempId ? { ...a, status: 'error', error: 'Upload failed' } : a)))
    }
  }

  function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) handleAttach(file)
  }

  async function handleSend() {
    if (!input.trim() || sending) return

    let activeConversationId = conversationId
    if (!activeConversationId) {
      try {
        const response = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        const body = await response.json()
        if (!response.ok) {
          setError(body.error?.message ?? 'Failed to start a new chat')
          return
        }
        activeConversationId = body.conversation.id
        onConversationCreated(activeConversationId!)
      } catch {
        setError('Failed to start a new chat')
        return
      }
    }

    const userMessage = input
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }, { role: 'assistant', content: '' }])
    setInput('')
    setSending(true)
    setError(null)

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeConversationId, message: userMessage }),
      })

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null)
        setError(body?.error?.message ?? 'Something went wrong')
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data:')) continue

          let event: { error?: string; delta?: string; done?: boolean; tokenCount?: number }
          try {
            event = JSON.parse(line.slice(5).trim())
          } catch {
            continue
          }

          if (event.error) {
            setError('The AI provider failed to respond. Please try again.')
            continue
          }

          if (event.delta) {
            setMessages((prev) => {
              const next = [...prev]
              next[next.length - 1] = { ...next[next.length - 1], content: next[next.length - 1].content + event.delta }
              return next
            })
          }

          if (event.done) {
            setMessages((prev) => {
              const next = [...prev]
              next[next.length - 1] = { ...next[next.length - 1], tokenCount: event.tokenCount }
              return next
            })
            setSessionTokens((prev) => prev + (event.tokenCount ?? 0))
          }
        }
      }
    } catch {
      setError('Something went wrong')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between border-b p-3 text-sm text-gray-600">
        <span>{conversationId ? 'Chat' : 'New chat'}</span>
        <span>Session tokens: {sessionTokens}</span>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div
              className={`inline-block max-w-lg rounded-lg px-3 py-2 text-sm ${
                m.role === 'user' ? 'bg-black text-white' : 'bg-gray-100'
              }`}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              {m.tokenCount !== undefined && (
                <div className="mt-1 text-xs opacity-60">{m.tokenCount} tokens</div>
              )}
            </div>
          </div>
        ))}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t px-3 pt-2">
          {attachments.map((a) => (
            <span
              key={a.id}
              className={`rounded-full border px-2 py-1 text-xs ${
                a.status === 'error' ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-300 bg-gray-50 text-gray-700'
              }`}
              title={a.error}
            >
              📎 {a.filename}
              {a.status === 'uploading' && '…'}
              {a.status === 'error' && ' (failed)'}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2 border-t p-3">
        <input ref={fileInputRef} type="file" accept=".pdf,.txt" className="hidden" onChange={handleFileInputChange} />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          className="rounded border px-3 py-2 text-sm disabled:opacity-50"
          title="Attach a PDF or TXT file"
        >
          📎
        </button>
        <input
          className="flex-1 rounded border px-3 py-2 text-sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask something…"
          disabled={sending}
        />
        <button
          onClick={handleSend}
          disabled={sending}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/chat/chat-window.tsx
git commit -m "feat: inline file attach in the chat compose box"
```

---

### Task 9: `chat/page.tsx` — lazy new-chat state, delete `/upload`

**Files:**
- Modify: `src/app/chat/page.tsx`
- Delete: `src/app/upload/page.tsx`
- Modify: `src/proxy.ts`

**Interfaces:**
- Consumes: `ChatWindow` (Task 8, new prop shape).

- [ ] **Step 1: Rewrite `chat/page.tsx`**

Replace `src/app/chat/page.tsx`:

```typescript
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ConversationSidebar } from './conversation-sidebar'
import { ChatWindow } from './chat-window'

interface ConversationSummary {
  id: string
  title: string
  createdAt: string
}

export default function ChatPage() {
  const router = useRouter()
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchConversations()
  }, [])

  function fetchConversations() {
    fetch('/api/conversations')
      .then((r) => r.json())
      .then((body) => setConversations(body.conversations ?? []))
      .catch(() => setError('Failed to load conversations'))
  }

  function handleConversationCreated(id: string) {
    setActiveId(id)
    fetchConversations()
  }

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      router.push('/login')
    }
  }

  return (
    <div className="flex h-screen">
      <ConversationSidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={() => setActiveId(null)}
      />
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-end border-b p-3 text-sm">
          <button
            onClick={handleLogout}
            className="rounded border px-3 py-1 text-gray-600 hover:bg-gray-50"
          >
            Log out
          </button>
        </div>
        {error && <p className="border-b bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        <ChatWindow conversationId={activeId} onConversationCreated={handleConversationCreated} />
      </div>
    </div>
  )
}
```

Note: no `key={activeId}` on `<ChatWindow>` — `ChatWindow` reacts to its `conversationId` prop changing via its own `useEffect` (Task 8). Adding a `key` here would remount the component on every lazy-creation callback, which can orphan an in-flight upload or send that was still using the pre-creation closure value.

- [ ] **Step 2: Delete the `/upload` page and its proxy matcher**

```bash
rm -rf src/app/upload
```

In `src/proxy.ts`, remove the `'/upload/:path*'` line from `config.matcher`:

```typescript
export const config = {
  matcher: [
    '/chat/:path*',
    '/api/documents/:path*',
    '/api/chat/:path*',
  ],
}
```

- [ ] **Step 3: Manual verification**

Run: `pnpm dev`, log in at `http://localhost:3000/login` (admin/admin123), then in the browser:

1. Land on `/chat` — no sidebar item highlighted, compose box already usable.
2. Click 📎, pick a `.txt` file — a chip with the filename appears, conversation gets created (a new item appears in the sidebar), compose box remains usable.
3. Type a message, press Enter — reply streams in, the same conversation is used (no second conversation created).
4. Click "New chat" in the sidebar — screen clears to the same fresh, unsaved state as step 1.
5. Attach and send in a second conversation with a different file; switch back to the first conversation in the sidebar — only the first file's chip shows, not the second's.
6. Navigate to `http://localhost:3000/upload` directly — should 404 (page deleted).

- [ ] **Step 4: Commit**

```bash
git add src/app/chat/page.tsx src/proxy.ts
git rm -r src/app/upload
git commit -m "feat: land on a fresh unsaved chat until the user acts, remove /upload"
```

---

### Task 10: Full suite verification + docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run the full test suite and typecheck**

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm lint
```

Expected: all green. Fix any fallout before proceeding (in particular, double check no remaining reference to `documentId` or `getContentText` survived outside this plan's changes — `grep -rn "documentId\|getContentText" src` should return nothing).

- [ ] **Step 2: Update `README.md`**

In the "Features Done" list, update the file-upload line to describe the new inline flow:

```markdown
- [x] File Upload (inline attach in the chat compose box, PDF/TXT, type/size validation, no raw file persisted to disk — only extracted text; each conversation only sees the documents attached to it)
```

Remove the line `- [ ] Citation of source spans (depends on RAG chunking, skipped alongside it)` only if it's still present unrelated to this change — otherwise leave the rest of the file as-is (RAG/citation status is unrelated to this feature and out of scope here).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: describe the inline chat upload flow"
```
