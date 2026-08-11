# Mini Knowledge Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js app with login, document upload + Q&A, AI chat, and token usage tracking, structured as clean-architecture feature modules.

**Architecture:** Each feature (`auth`, `documents`, `chat`) is split into `domain` (entities, no dependencies), `application` (use-cases + port interfaces), and `infrastructure` (SQLite, OpenRouter, filesystem adapters implementing the ports). Next.js route handlers under `src/app` compose a use-case with its concrete infrastructure and act as the thin presentation layer. `src/proxy.ts` guards protected routes by verifying the JWT cookie.

**Tech Stack:** Next.js 16.3 (App Router), TypeScript, Tailwind, better-sqlite3, bcryptjs, jose (JWT), zod, pdf-parse, react-markdown + remark-gfm, vitest.

## Global Constraints

- Next.js 16.3: use `proxy.ts` (not `middleware.ts`) for the edge auth guard — `middleware.js` is deprecated in this version. Place it at `src/proxy.ts` (project uses the `src` folder).
- `params` / `searchParams` in pages are async (`Promise`) — always `await` them.
- Mock user: username `admin`, password `admin123` (seeded, bcrypt-hashed — never store plaintext).
- No hardcoded secrets — `OPENROUTER_API_KEY` and `JWT_SECRET` come from `.env` (never committed; `.env.example` documents them).
- `domain/` files import nothing outside their own module. `application/` files import only `domain` and their own `application/ports.ts` — never a concrete `infrastructure` class. `infrastructure/` implements the ports and may import third-party libraries freely.
- Package manager is `pnpm` (see `pnpm-workspace.yaml` / lockfile already in repo).
- Every task ends with a `git commit` — logical, incremental history is required.

---

### Task 1: Project dependencies, env, shared kernel, DB bootstrap

**Files:**
- Modify: `package.json` (add dependencies)
- Create: `.env.example`
- Create: `.gitignore` entry check (ensure `.env`, `*.db` ignored)
- Create: `src/shared/kernel/result.ts`
- Create: `src/shared/db/schema.sql`
- Create: `src/shared/db/client.ts`
- Test: `src/shared/kernel/result.test.ts`

**Interfaces:**
- Produces: `Result<T, E>` discriminated union type, used by every use-case in later tasks.
- Produces: `getDb(): Database` (better-sqlite3 instance, schema applied on first call), used by every `infrastructure` repository in later tasks.

- [ ] **Step 1: Install dependencies**

```bash
pnpm add better-sqlite3 bcryptjs jose zod pdf-parse react-markdown remark-gfm
pnpm add -D vitest @vitest/coverage-v8 @types/better-sqlite3 @types/bcryptjs
```

- [ ] **Step 2: Add `.env.example`**

```
OPENROUTER_API_KEY=
JWT_SECRET=change-me-to-a-long-random-string
DATABASE_PATH=./data/app.db
```

- [ ] **Step 3: Confirm `.gitignore` covers secrets and the DB file**

Open `.gitignore`, ensure it contains (add any missing lines):

```
.env
.env.local
data/*.db
```

- [ ] **Step 4: Write the failing test for `Result`**

```typescript
// src/shared/kernel/result.test.ts
import { describe, it, expect } from 'vitest'
import { ok, err, isOk } from './result'

describe('Result', () => {
  it('wraps a success value', () => {
    const r = ok(42)
    expect(isOk(r)).toBe(true)
    if (isOk(r)) expect(r.value).toBe(42)
  })

  it('wraps an error value', () => {
    const r = err('BAD_INPUT')
    expect(isOk(r)).toBe(false)
    if (!isOk(r)) expect(r.error).toBe('BAD_INPUT')
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm vitest run src/shared/kernel/result.test.ts`
Expected: FAIL — `./result` has no exported member `ok`/`err`/`isOk`.

- [ ] **Step 6: Implement `Result`**

```typescript
// src/shared/kernel/result.ts
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run src/shared/kernel/result.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 8: Write the DB schema**

```sql
-- src/shared/db/schema.sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  content_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 9: Implement the DB client**

```typescript
// src/shared/db/client.ts
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  const dbPath = process.env.DATABASE_PATH ?? './data/app.db'
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  const schema = fs.readFileSync(
    path.join(process.cwd(), 'src/shared/db/schema.sql'),
    'utf-8'
  )
  db.exec(schema)

  return db
}
```

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example .gitignore src/shared
git commit -m "chore: add dependencies, shared kernel Result type, SQLite bootstrap"
```

---

### Task 2: Auth domain + application (LoginUseCase, VerifySessionUseCase)

**Files:**
- Create: `src/modules/auth/domain/user.ts`
- Create: `src/modules/auth/application/ports.ts`
- Create: `src/modules/auth/application/login-use-case.ts`
- Create: `src/modules/auth/application/verify-session-use-case.ts`
- Test: `src/modules/auth/application/login-use-case.test.ts`
- Test: `src/modules/auth/application/verify-session-use-case.test.ts`

**Interfaces:**
- Consumes: `Result`, `ok`, `err` from `src/shared/kernel/result.ts` (Task 1).
- Produces: `User` entity `{ id: string; username: string; passwordHash: string; createdAt: string }`.
- Produces: ports `UserRepository.findByUsername(username: string): Promise<User | null>`, `PasswordHasher.verify(password: string, hash: string): Promise<boolean>`, `TokenService.sign(payload: { userId: string }): Promise<string>`, `TokenService.verify(token: string): Promise<{ userId: string } | null>`.
- Produces: `LoginUseCase.execute(username: string, password: string): Promise<Result<{ token: string }, 'INVALID_CREDENTIALS'>>`, used by the login route in Task 4.
- Produces: `VerifySessionUseCase.execute(token: string | undefined): Promise<{ userId: string } | null>`, used by `src/proxy.ts` in Task 4.

- [ ] **Step 1: Define the domain entity**

```typescript
// src/modules/auth/domain/user.ts
export interface User {
  id: string
  username: string
  passwordHash: string
  createdAt: string
}
```

- [ ] **Step 2: Define the ports**

```typescript
// src/modules/auth/application/ports.ts
import type { User } from '../domain/user'

export interface UserRepository {
  findByUsername(username: string): Promise<User | null>
}

export interface PasswordHasher {
  verify(password: string, hash: string): Promise<boolean>
}

export interface TokenService {
  sign(payload: { userId: string }): Promise<string>
  verify(token: string): Promise<{ userId: string } | null>
}
```

- [ ] **Step 3: Write the failing test for `LoginUseCase`**

```typescript
// src/modules/auth/application/login-use-case.test.ts
import { describe, it, expect, vi } from 'vitest'
import { LoginUseCase } from './login-use-case'
import type { UserRepository, PasswordHasher, TokenService } from './ports'
import type { User } from '../domain/user'

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    username: 'admin',
    passwordHash: 'hashed',
    createdAt: '2026-01-01',
    ...overrides,
  }
}

describe('LoginUseCase', () => {
  it('returns a token on valid credentials', async () => {
    const users: UserRepository = { findByUsername: vi.fn(async () => makeUser()) }
    const hasher: PasswordHasher = { verify: vi.fn(async () => true) }
    const tokens: TokenService = {
      sign: vi.fn(async () => 'signed-token'),
      verify: vi.fn(async () => null),
    }
    const useCase = new LoginUseCase(users, hasher, tokens)

    const result = await useCase.execute('admin', 'admin123')

    expect(result).toEqual({ ok: true, value: { token: 'signed-token' } })
    expect(tokens.sign).toHaveBeenCalledWith({ userId: 'u1' })
  })

  it('fails when the user does not exist', async () => {
    const users: UserRepository = { findByUsername: vi.fn(async () => null) }
    const hasher: PasswordHasher = { verify: vi.fn(async () => true) }
    const tokens: TokenService = { sign: vi.fn(), verify: vi.fn() }
    const useCase = new LoginUseCase(users, hasher, tokens)

    const result = await useCase.execute('nobody', 'x')

    expect(result).toEqual({ ok: false, error: 'INVALID_CREDENTIALS' })
    expect(tokens.sign).not.toHaveBeenCalled()
  })

  it('fails when the password does not match', async () => {
    const users: UserRepository = { findByUsername: vi.fn(async () => makeUser()) }
    const hasher: PasswordHasher = { verify: vi.fn(async () => false) }
    const tokens: TokenService = { sign: vi.fn(), verify: vi.fn() }
    const useCase = new LoginUseCase(users, hasher, tokens)

    const result = await useCase.execute('admin', 'wrong')

    expect(result).toEqual({ ok: false, error: 'INVALID_CREDENTIALS' })
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run src/modules/auth/application/login-use-case.test.ts`
Expected: FAIL — `./login-use-case` module not found.

- [ ] **Step 5: Implement `LoginUseCase`**

```typescript
// src/modules/auth/application/login-use-case.ts
import { ok, err, type Result } from '@/shared/kernel/result'
import type { UserRepository, PasswordHasher, TokenService } from './ports'

export class LoginUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService
  ) {}

  async execute(
    username: string,
    password: string
  ): Promise<Result<{ token: string }, 'INVALID_CREDENTIALS'>> {
    const user = await this.users.findByUsername(username)
    if (!user) return err('INVALID_CREDENTIALS')

    const valid = await this.hasher.verify(password, user.passwordHash)
    if (!valid) return err('INVALID_CREDENTIALS')

    const token = await this.tokens.sign({ userId: user.id })
    return ok({ token })
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run src/modules/auth/application/login-use-case.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Write the failing test for `VerifySessionUseCase`**

```typescript
// src/modules/auth/application/verify-session-use-case.test.ts
import { describe, it, expect, vi } from 'vitest'
import { VerifySessionUseCase } from './verify-session-use-case'
import type { TokenService } from './ports'

describe('VerifySessionUseCase', () => {
  it('returns null when no token is given', async () => {
    const tokens: TokenService = { sign: vi.fn(), verify: vi.fn() }
    const useCase = new VerifySessionUseCase(tokens)
    expect(await useCase.execute(undefined)).toBeNull()
    expect(tokens.verify).not.toHaveBeenCalled()
  })

  it('delegates to TokenService.verify when a token is given', async () => {
    const tokens: TokenService = {
      sign: vi.fn(),
      verify: vi.fn(async () => ({ userId: 'u1' })),
    }
    const useCase = new VerifySessionUseCase(tokens)
    expect(await useCase.execute('abc')).toEqual({ userId: 'u1' })
  })
})
```

- [ ] **Step 8: Run test to verify it fails**

Run: `pnpm vitest run src/modules/auth/application/verify-session-use-case.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 9: Implement `VerifySessionUseCase`**

```typescript
// src/modules/auth/application/verify-session-use-case.ts
import type { TokenService } from './ports'

export class VerifySessionUseCase {
  constructor(private readonly tokens: TokenService) {}

  async execute(token: string | undefined): Promise<{ userId: string } | null> {
    if (!token) return null
    return this.tokens.verify(token)
  }
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `pnpm vitest run src/modules/auth/application/verify-session-use-case.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 11: Commit**

```bash
git add src/modules/auth/domain src/modules/auth/application
git commit -m "feat(auth): add LoginUseCase and VerifySessionUseCase with tests"
```

---

### Task 3: Auth infrastructure + seed script

**Files:**
- Create: `src/modules/auth/infrastructure/sqlite-user-repository.ts`
- Create: `src/modules/auth/infrastructure/bcrypt-password-hasher.ts`
- Create: `src/modules/auth/infrastructure/jwt-token-service.ts`
- Create: `src/modules/auth/infrastructure/seed-admin.ts`
- Create: `scripts/seed.ts`
- Modify: `package.json` (add `"seed"` script)

**Interfaces:**
- Consumes: `getDb()` from Task 1, `User`/ports from Task 2.
- Produces: `SqliteUserRepository implements UserRepository`, `BcryptPasswordHasher implements PasswordHasher`, `JwtTokenService implements TokenService` — composed by the API routes in Task 4.
- Produces: `seedAdmin(): Promise<void>` — inserts the `admin`/`admin123` mock user if not present, called by `scripts/seed.ts` and once from the login route on cold start (see Task 4).

- [ ] **Step 1: Implement `SqliteUserRepository`**

```typescript
// src/modules/auth/infrastructure/sqlite-user-repository.ts
import { getDb } from '@/shared/db/client'
import type { UserRepository } from '../application/ports'
import type { User } from '../domain/user'

interface UserRow {
  id: string
  username: string
  password_hash: string
  created_at: string
}

export class SqliteUserRepository implements UserRepository {
  async findByUsername(username: string): Promise<User | null> {
    const row = getDb()
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username) as UserRow | undefined

    if (!row) return null

    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
    }
  }
}
```

- [ ] **Step 2: Implement `BcryptPasswordHasher`**

```typescript
// src/modules/auth/infrastructure/bcrypt-password-hasher.ts
import bcrypt from 'bcryptjs'
import type { PasswordHasher } from '../application/ports'

export class BcryptPasswordHasher implements PasswordHasher {
  async verify(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash)
  }
}
```

- [ ] **Step 3: Implement `JwtTokenService`**

```typescript
// src/modules/auth/infrastructure/jwt-token-service.ts
import { SignJWT, jwtVerify } from 'jose'
import type { TokenService } from '../application/ports'

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not set')
  return new TextEncoder().encode(secret)
}

export class JwtTokenService implements TokenService {
  async sign(payload: { userId: string }): Promise<string> {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(getSecret())
  }

  async verify(token: string): Promise<{ userId: string } | null> {
    try {
      const { payload } = await jwtVerify(token, getSecret())
      if (typeof payload.userId !== 'string') return null
      return { userId: payload.userId }
    } catch {
      return null
    }
  }
}
```

- [ ] **Step 4: Implement the seed helper**

```typescript
// src/modules/auth/infrastructure/seed-admin.ts
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { getDb } from '@/shared/db/client'

export async function seedAdmin(): Promise<void> {
  const db = getDb()
  const existing = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get('admin')

  if (existing) return

  const passwordHash = await bcrypt.hash('admin123', 10)
  db.prepare(
    'INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)'
  ).run(randomUUID(), 'admin', passwordHash)
}
```

- [ ] **Step 5: Add the CLI seed script**

```typescript
// scripts/seed.ts
import { seedAdmin } from '../src/modules/auth/infrastructure/seed-admin'

seedAdmin()
  .then(() => {
    console.log('Seeded admin user (admin/admin123)')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Seed failed:', error)
    process.exit(1)
  })
```

Add to `package.json` `"scripts"`:

```json
"seed": "tsx scripts/seed.ts"
```

Run: `pnpm add -D tsx`

- [ ] **Step 6: Run the seed script manually to verify**

Run: `pnpm seed`
Expected: prints `Seeded admin user (admin/admin123)`, and `data/app.db` now contains one row in `users`.

- [ ] **Step 7: Commit**

```bash
git add src/modules/auth/infrastructure scripts package.json pnpm-lock.yaml
git commit -m "feat(auth): add SQLite/bcrypt/JWT infrastructure and admin seed script"
```

---

### Task 4: Auth API routes, proxy guard, login page

**Files:**
- Create: `src/modules/auth/infrastructure/factory.ts`
- Create: `src/app/api/auth/login/route.ts`
- Create: `src/app/api/auth/logout/route.ts`
- Create: `src/proxy.ts`
- Create: `src/app/login/page.tsx`
- Modify: `src/app/page.tsx` (redirect to `/login` or `/chat`)

**Interfaces:**
- Consumes: `LoginUseCase`, `VerifySessionUseCase` (Task 2), `SqliteUserRepository`, `BcryptPasswordHasher`, `JwtTokenService`, `seedAdmin` (Task 3).
- Produces: cookie name constant `AUTH_COOKIE = 'session'`, used by every protected route going forward.

- [ ] **Step 1: Add a small factory to compose auth use-cases**

```typescript
// src/modules/auth/infrastructure/factory.ts
import { LoginUseCase } from '../application/login-use-case'
import { VerifySessionUseCase } from '../application/verify-session-use-case'
import { SqliteUserRepository } from './sqlite-user-repository'
import { BcryptPasswordHasher } from './bcrypt-password-hasher'
import { JwtTokenService } from './jwt-token-service'

const tokenService = new JwtTokenService()

export function makeLoginUseCase(): LoginUseCase {
  return new LoginUseCase(
    new SqliteUserRepository(),
    new BcryptPasswordHasher(),
    tokenService
  )
}

export function makeVerifySessionUseCase(): VerifySessionUseCase {
  return new VerifySessionUseCase(tokenService)
}

export const AUTH_COOKIE = 'session'
```

- [ ] **Step 2: Implement the login route**

```typescript
// src/app/api/auth/login/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeLoginUseCase, AUTH_COOKIE } from '@/modules/auth/infrastructure/factory'
import { seedAdmin } from '@/modules/auth/infrastructure/seed-admin'

const bodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

export async function POST(request: Request) {
  await seedAdmin()

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_BODY', message: 'username and password are required' } },
      { status: 400 }
    )
  }

  const result = await makeLoginUseCase().execute(
    parsed.data.username,
    parsed.data.password
  )

  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.error, message: 'Invalid username or password' } },
      { status: 401 }
    )
  }

  const response = NextResponse.json({ success: true })
  response.cookies.set(AUTH_COOKIE, result.value.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24,
  })
  return response
}
```

- [ ] **Step 3: Implement the logout route**

```typescript
// src/app/api/auth/logout/route.ts
import { NextResponse } from 'next/server'
import { AUTH_COOKIE } from '@/modules/auth/infrastructure/factory'

export async function POST() {
  const response = NextResponse.json({ success: true })
  response.cookies.delete(AUTH_COOKIE)
  return response
}
```

- [ ] **Step 4: Implement `src/proxy.ts`**

```typescript
// src/proxy.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { makeVerifySessionUseCase, AUTH_COOKIE } from '@/modules/auth/infrastructure/factory'

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE)?.value
  const session = await makeVerifySessionUseCase().execute(token)

  if (!session) {
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
        { status: 401 }
      )
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/chat/:path*',
    '/upload/:path*',
    '/api/documents/:path*',
    '/api/chat/:path*',
  ],
}
```

- [ ] **Step 5: Build the login page**

```tsx
// src/app/login/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)

    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })

    setLoading(false)

    if (!response.ok) {
      const body = await response.json()
      setError(body.error?.message ?? 'Login failed')
      return
    }

    router.push('/chat')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border bg-white p-6 shadow-sm"
      >
        <h1 className="text-xl font-semibold">Sign in</h1>
        <div>
          <label className="block text-sm font-medium" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            className="mt-1 w-full rounded border px-3 py-2"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="mt-1 w-full rounded border px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
```

- [ ] **Step 6: Redirect the home page**

```tsx
// src/app/page.tsx
import { redirect } from 'next/navigation'

export default function Home() {
  redirect('/chat')
}
```

- [ ] **Step 7: Manual verification**

Run: `pnpm dev`, then:
- Visit `/chat` while logged out → expect redirect to `/login`.
- Log in with `admin` / `admin123` → expect redirect to `/chat` (page not built yet, 404 is fine for now — confirms the cookie was set and proxy let the request through instead of redirecting).
- Log in with a wrong password → expect an inline error message, no redirect.

- [ ] **Step 8: Commit**

```bash
git add src/modules/auth/infrastructure/factory.ts src/app/api/auth src/proxy.ts src/app/login src/app/page.tsx
git commit -m "feat(auth): add login/logout routes, proxy auth guard, login page"
```

---

### Task 5: Documents domain + application

**Files:**
- Create: `src/modules/documents/domain/document.ts`
- Create: `src/modules/documents/application/ports.ts`
- Create: `src/modules/documents/application/upload-document-use-case.ts`
- Test: `src/modules/documents/application/upload-document-use-case.test.ts`

**Interfaces:**
- Consumes: `Result`/`ok`/`err` from Task 1.
- Produces: `Document` entity `{ id, userId, filename, mimeType, sizeBytes, contentText, createdAt }`.
- Produces: ports `DocumentRepository.save(doc: Document): Promise<void>`, `TextExtractor.extract(buffer: Buffer, mimeType: string): Promise<string>`.
- Produces: `UploadDocumentUseCase.execute(input: { userId: string; filename: string; mimeType: string; buffer: Buffer }): Promise<Result<Document, 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'EMPTY_FILE'>>`, used by the upload route in Task 7.

- [ ] **Step 1: Define the domain entity**

```typescript
// src/modules/documents/domain/document.ts
export interface Document {
  id: string
  userId: string
  filename: string
  mimeType: string
  sizeBytes: number
  contentText: string
  createdAt: string
}
```

- [ ] **Step 2: Define the ports**

```typescript
// src/modules/documents/application/ports.ts
import type { Document } from '../domain/document'

export interface DocumentRepository {
  save(doc: Document): Promise<void>
  findById(id: string, userId: string): Promise<Document | null>
}

export interface TextExtractor {
  extract(buffer: Buffer, mimeType: string): Promise<string>
}

export interface IdGenerator {
  generate(): string
}
```

- [ ] **Step 3: Write the failing test for `UploadDocumentUseCase`**

```typescript
// src/modules/documents/application/upload-document-use-case.test.ts
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
      filename: 'empty.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(''),
    })
    expect(result).toEqual({ ok: false, error: 'EMPTY_FILE' })
  })

  it('saves and returns the document on success', async () => {
    const { useCase, repo } = makeUseCase()
    const result = await useCase.execute({
      userId: 'u1',
      filename: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello world'),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.id).toBe('doc-1')
      expect(result.value.contentText).toBe('extracted text')
    }
    expect(repo.save).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run src/modules/documents/application/upload-document-use-case.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `UploadDocumentUseCase`**

```typescript
// src/modules/documents/application/upload-document-use-case.ts
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

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run src/modules/documents/application/upload-document-use-case.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
git add src/modules/documents/domain src/modules/documents/application
git commit -m "feat(documents): add UploadDocumentUseCase with validation and tests"
```

---

### Task 6: Documents infrastructure + upload route + upload page

**Files:**
- Create: `src/modules/documents/infrastructure/sqlite-document-repository.ts`
- Create: `src/modules/documents/infrastructure/pdf-text-extractor.ts`
- Create: `src/modules/documents/infrastructure/factory.ts`
- Create: `src/app/api/documents/route.ts`
- Create: `src/app/upload/page.tsx`

**Interfaces:**
- Consumes: `Document`/ports (Task 5), `getDb()` (Task 1), auth cookie/`VerifySessionUseCase` (Task 2/4).
- Produces: `makeUploadDocumentUseCase()`, used by `POST /api/documents`; documents fetched via `GET /api/documents` for the upload page's file picker in Task 9's chat page.

- [ ] **Step 1: Implement the SQLite repository**

```typescript
// src/modules/documents/infrastructure/sqlite-document-repository.ts
import { getDb } from '@/shared/db/client'
import type { DocumentRepository } from '../application/ports'
import type { Document } from '../domain/document'

interface DocumentRow {
  id: string
  user_id: string
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
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    contentText: row.content_text,
    createdAt: row.created_at,
  }
}

export class SqliteDocumentRepository implements DocumentRepository {
  async save(doc: Document): Promise<void> {
    getDb()
      .prepare(
        `INSERT INTO documents (id, user_id, filename, mime_type, size_bytes, content_text)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(doc.id, doc.userId, doc.filename, doc.mimeType, doc.sizeBytes, doc.contentText)
  }

  async findById(id: string, userId: string): Promise<Document | null> {
    const row = getDb()
      .prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?')
      .get(id, userId) as DocumentRow | undefined
    return row ? toDocument(row) : null
  }

  async listByUser(userId: string): Promise<Document[]> {
    const rows = getDb()
      .prepare('SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as DocumentRow[]
    return rows.map(toDocument)
  }
}
```

- [ ] **Step 2: Implement the PDF/TXT text extractor**

```typescript
// src/modules/documents/infrastructure/pdf-text-extractor.ts
import pdfParse from 'pdf-parse'
import type { TextExtractor } from '../application/ports'

export class PdfTextExtractor implements TextExtractor {
  async extract(buffer: Buffer, mimeType: string): Promise<string> {
    if (mimeType === 'text/plain') {
      return buffer.toString('utf-8')
    }
    if (mimeType === 'application/pdf') {
      const parsed = await pdfParse(buffer)
      return parsed.text
    }
    throw new Error(`Unsupported mime type: ${mimeType}`)
  }
}
```

- [ ] **Step 3: Add the factory**

```typescript
// src/modules/documents/infrastructure/factory.ts
import { randomUUID } from 'node:crypto'
import { UploadDocumentUseCase } from '../application/upload-document-use-case'
import { SqliteDocumentRepository } from './sqlite-document-repository'
import { PdfTextExtractor } from './pdf-text-extractor'

export function makeUploadDocumentUseCase(): UploadDocumentUseCase {
  return new UploadDocumentUseCase(
    new SqliteDocumentRepository(),
    new PdfTextExtractor(),
    { generate: () => randomUUID() }
  )
}

export function makeDocumentRepository(): SqliteDocumentRepository {
  return new SqliteDocumentRepository()
}
```

- [ ] **Step 4: Implement the upload/list route**

Filename sanitization: only the extracted text and the original filename (display-only, never used as a filesystem path) are stored — no file is written to disk, which removes path-traversal risk entirely.

```typescript
// src/app/api/documents/route.ts
import { NextResponse } from 'next/server'
import { makeUploadDocumentUseCase, makeDocumentRepository } from '@/modules/documents/infrastructure/factory'
import { makeVerifySessionUseCase, AUTH_COOKIE } from '@/modules/auth/infrastructure/factory'

async function getUserId(request: Request): Promise<string | null> {
  const cookieHeader = request.headers.get('cookie') ?? ''
  const match = cookieHeader.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`))
  const token = match?.[1]
  const session = await makeVerifySessionUseCase().execute(token)
  return session?.userId ?? null
}

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

  const buffer = Buffer.from(await file.arrayBuffer())
  const result = await makeUploadDocumentUseCase().execute({
    userId,
    filename: file.name,
    mimeType: file.type,
    buffer,
  })

  if (!result.ok) {
    return NextResponse.json({ error: { code: result.error, message: uploadErrorMessage(result.error) } }, { status: 400 })
  }

  return NextResponse.json({
    id: result.value.id,
    filename: result.value.filename,
    charCount: result.value.contentText.length,
  })
}

export async function GET(request: Request) {
  const userId = await getUserId(request)
  if (!userId) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } }, { status: 401 })
  }

  const docs = await makeDocumentRepository().listByUser(userId)
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

- [ ] **Step 5: Build the upload page**

```tsx
// src/app/upload/page.tsx
'use client'

import { useState } from 'react'

export default function UploadPage() {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setStatus('uploading')
    setMessage(null)

    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch('/api/documents', { method: 'POST', body: formData })
    const body = await response.json()

    if (!response.ok) {
      setStatus('error')
      setMessage(body.error?.message ?? 'Upload failed')
      return
    }

    setStatus('done')
    setMessage(`Uploaded "${body.filename}" (${body.charCount} characters extracted)`)
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Upload a document</h1>
      <input type="file" accept=".pdf,.txt" onChange={handleUpload} />
      {status === 'uploading' && <p className="mt-4 text-sm text-gray-500">Uploading…</p>}
      {message && (
        <p className={`mt-4 text-sm ${status === 'error' ? 'text-red-600' : 'text-green-700'}`}>
          {message}
        </p>
      )}
    </main>
  )
}
```

- [ ] **Step 6: Manual verification**

Run: `pnpm dev`, log in, go to `/upload`, upload a small `.txt` file → expect a success message with a character count. Try a `.png` → expect the "Only PDF and TXT files are supported" error.

- [ ] **Step 7: Commit**

```bash
git add src/modules/documents/infrastructure src/app/api/documents src/app/upload
git commit -m "feat(documents): add SQLite repo, PDF/TXT extractor, upload route and page"
```

---

### Task 7: Chat domain + application (context building, sending a message)

**Files:**
- Create: `src/modules/chat/domain/message.ts`
- Create: `src/modules/chat/application/ports.ts`
- Create: `src/modules/chat/application/build-context-use-case.ts`
- Create: `src/modules/chat/application/send-message-use-case.ts`
- Test: `src/modules/chat/application/build-context-use-case.test.ts`
- Test: `src/modules/chat/application/send-message-use-case.test.ts`

**Interfaces:**
- Consumes: `Result`/`ok`/`err` (Task 1), `Document` type shape for context lookup (Task 5, via a narrow `DocumentTextLookup` port to avoid depending on the `documents` module's concrete repository).
- Produces: `Message`/`Conversation` entities.
- Produces: ports `MessageRepository.save(message: Message): Promise<void>`, `MessageRepository.listByConversation(conversationId: string): Promise<Message[]>`, `AiProvider.complete(input: { systemPrompt?: string; messages: { role: string; content: string }[] }): Promise<{ content: string; tokenCount: number }>`, `DocumentTextLookup.getContentText(documentId: string, userId: string): Promise<string | null>`.
- Produces: `BuildContextUseCase.execute(input: { documentId?: string; userId: string }): Promise<string | null>` (returns a system prompt or null), used by `SendMessageUseCase`.
- Produces: `SendMessageUseCase.execute(input: { userId: string; conversationId: string; userMessage: string; documentId?: string }): Promise<Result<{ reply: string; tokenCount: number }, 'AI_PROVIDER_ERROR'>>`, used by the chat route in Task 9.

- [ ] **Step 1: Define the domain entities**

```typescript
// src/modules/chat/domain/message.ts
export type MessageRole = 'user' | 'assistant' | 'system'

export interface Message {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  tokenCount: number
  createdAt: string
}

export interface Conversation {
  id: string
  userId: string
  title: string
  createdAt: string
}
```

- [ ] **Step 2: Define the ports**

```typescript
// src/modules/chat/application/ports.ts
import type { Message, Conversation } from '../domain/message'

export interface MessageRepository {
  save(message: Message): Promise<void>
  listByConversation(conversationId: string): Promise<Message[]>
}

export interface ConversationRepository {
  save(conversation: Conversation): Promise<void>
  findById(id: string, userId: string): Promise<Conversation | null>
  listByUser(userId: string): Promise<Conversation[]>
}

export interface AiProvider {
  complete(input: {
    systemPrompt?: string
    messages: { role: 'user' | 'assistant'; content: string }[]
  }): Promise<{ content: string; tokenCount: number }>
}

export interface DocumentTextLookup {
  getContentText(documentId: string, userId: string): Promise<string | null>
}

export interface IdGenerator {
  generate(): string
}
```

- [ ] **Step 3: Write the failing test for `BuildContextUseCase`**

```typescript
// src/modules/chat/application/build-context-use-case.test.ts
import { describe, it, expect, vi } from 'vitest'
import { BuildContextUseCase } from './build-context-use-case'
import type { DocumentTextLookup } from './ports'

describe('BuildContextUseCase', () => {
  it('returns null when no documentId is given', async () => {
    const lookup: DocumentTextLookup = { getContentText: vi.fn() }
    const useCase = new BuildContextUseCase(lookup)
    expect(await useCase.execute({ userId: 'u1' })).toBeNull()
    expect(lookup.getContentText).not.toHaveBeenCalled()
  })

  it('returns a system prompt built from the document text', async () => {
    const lookup: DocumentTextLookup = {
      getContentText: vi.fn(async () => 'The quick brown fox'),
    }
    const useCase = new BuildContextUseCase(lookup)
    const prompt = await useCase.execute({ userId: 'u1', documentId: 'doc-1' })
    expect(prompt).toContain('The quick brown fox')
  })

  it('truncates content that exceeds the token budget', async () => {
    const longText = 'a'.repeat(50_000)
    const lookup: DocumentTextLookup = { getContentText: vi.fn(async () => longText) }
    const useCase = new BuildContextUseCase(lookup, { maxChars: 1000 })
    const prompt = await useCase.execute({ userId: 'u1', documentId: 'doc-1' })
    expect(prompt!.length).toBeLessThan(1200)
  })

  it('returns null when the document is not found', async () => {
    const lookup: DocumentTextLookup = { getContentText: vi.fn(async () => null) }
    const useCase = new BuildContextUseCase(lookup)
    expect(await useCase.execute({ userId: 'u1', documentId: 'missing' })).toBeNull()
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run src/modules/chat/application/build-context-use-case.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `BuildContextUseCase`**

```typescript
// src/modules/chat/application/build-context-use-case.ts
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

  async execute(input: { userId: string; documentId?: string }): Promise<string | null> {
    if (!input.documentId) return null

    const text = await this.lookup.getContentText(input.documentId, input.userId)
    if (!text) return null

    const truncated = text.length > this.maxChars ? text.slice(0, this.maxChars) : text

    return [
      'You are a helpful assistant answering questions about the following document.',
      'Only use information from the document below; say so if the answer is not in it.',
      '---',
      truncated,
      '---',
    ].join('\n')
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run src/modules/chat/application/build-context-use-case.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Write the failing test for `SendMessageUseCase`**

```typescript
// src/modules/chat/application/send-message-use-case.test.ts
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
    ...overrides.ai,
  }
  const ids: IdGenerator = { generate: vi.fn(() => 'msg-1') }
  const lookup: DocumentTextLookup = { getContentText: vi.fn(async () => null) }
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

- [ ] **Step 8: Run test to verify it fails**

Run: `pnpm vitest run src/modules/chat/application/send-message-use-case.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 9: Implement `SendMessageUseCase`**

```typescript
// src/modules/chat/application/send-message-use-case.ts
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
    documentId?: string
  }): Promise<Result<{ reply: string; tokenCount: number }, 'AI_PROVIDER_ERROR'>> {
    const history = await this.messages.listByConversation(input.conversationId)
    const systemPrompt = await this.buildContext.execute({
      userId: input.userId,
      documentId: input.documentId,
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

- [ ] **Step 10: Run test to verify it passes**

Run: `pnpm vitest run src/modules/chat/application/send-message-use-case.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 11: Commit**

```bash
git add src/modules/chat/domain src/modules/chat/application
git commit -m "feat(chat): add BuildContextUseCase and SendMessageUseCase with tests"
```

---

### Task 8: Chat infrastructure (OpenRouter adapter, SQLite repos)

**Files:**
- Create: `src/modules/chat/infrastructure/openrouter-provider.ts`
- Create: `src/modules/chat/infrastructure/sqlite-message-repository.ts`
- Create: `src/modules/chat/infrastructure/sqlite-conversation-repository.ts`
- Create: `src/modules/chat/infrastructure/document-text-lookup.ts`
- Create: `src/modules/chat/infrastructure/factory.ts`
- Test: `src/modules/chat/infrastructure/openrouter-provider.test.ts`

**Interfaces:**
- Consumes: ports from Task 7, `getDb()` from Task 1, `SqliteDocumentRepository` from Task 6 (only inside this adapter — keeps the cross-module dependency at the infrastructure edge, not in `chat/application`).
- Produces: `makeSendMessageUseCase()`, `makeConversationRepository()`, used by the chat route in Task 9.

- [ ] **Step 1: Write the failing test for the OpenRouter timeout/error behavior**

```typescript
// src/modules/chat/infrastructure/openrouter-provider.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenRouterProvider } from './openrouter-provider'

describe('OpenRouterProvider', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key'
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('parses a successful completion', async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hi there' } }],
          usage: { total_tokens: 7 },
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch

    const provider = new OpenRouterProvider()
    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] })

    expect(result).toEqual({ content: 'hi there', tokenCount: 7 })
  })

  it('throws when the API responds with an error status', async () => {
    global.fetch = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch

    const provider = new OpenRouterProvider()
    await expect(
      provider.complete({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/modules/chat/infrastructure/openrouter-provider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `OpenRouterProvider`**

```typescript
// src/modules/chat/infrastructure/openrouter-provider.ts
import type { AiProvider } from '../application/ports'

const MODEL = 'meta-llama/llama-3.1-8b-instruct:free'
const TIMEOUT_MS = 30_000

export class OpenRouterProvider implements AiProvider {
  async complete(input: {
    systemPrompt?: string
    messages: { role: 'user' | 'assistant'; content: string }[]
  }): Promise<{ content: string; tokenCount: number }> {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set')

    const body = {
      model: MODEL,
      messages: [
        ...(input.systemPrompt ? [{ role: 'system', content: input.systemPrompt }] : []),
        ...input.messages,
      ],
    }

    const attempt = () => this.callOnce(apiKey, body)

    try {
      return await attempt()
    } catch {
      // one retry on network failure
      return await attempt()
    }
  }

  private async callOnce(
    apiKey: string,
    body: unknown
  ): Promise<{ content: string; tokenCount: number }> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`OpenRouter error: ${response.status}`)
      }

      const data = await response.json()
      const content: string = data.choices?.[0]?.message?.content ?? ''
      const tokenCount: number = data.usage?.total_tokens ?? Math.ceil(content.length / 4)

      return { content, tokenCount }
    } finally {
      clearTimeout(timeout)
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/modules/chat/infrastructure/openrouter-provider.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Implement the SQLite message/conversation repositories**

```typescript
// src/modules/chat/infrastructure/sqlite-message-repository.ts
import { getDb } from '@/shared/db/client'
import type { MessageRepository } from '../application/ports'
import type { Message, MessageRole } from '../domain/message'

interface MessageRow {
  id: string
  conversation_id: string
  role: MessageRole
  content: string
  token_count: number
  created_at: string
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    tokenCount: row.token_count,
    createdAt: row.created_at,
  }
}

export class SqliteMessageRepository implements MessageRepository {
  async save(message: Message): Promise<void> {
    getDb()
      .prepare(
        `INSERT INTO messages (id, conversation_id, role, content, token_count)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(message.id, message.conversationId, message.role, message.content, message.tokenCount)
  }

  async listByConversation(conversationId: string): Promise<Message[]> {
    const rows = getDb()
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
      .all(conversationId) as MessageRow[]
    return rows.map(toMessage)
  }

  async totalTokensForConversation(conversationId: string): Promise<number> {
    const row = getDb()
      .prepare('SELECT COALESCE(SUM(token_count), 0) as total FROM messages WHERE conversation_id = ?')
      .get(conversationId) as { total: number }
    return row.total
  }
}
```

```typescript
// src/modules/chat/infrastructure/sqlite-conversation-repository.ts
import { getDb } from '@/shared/db/client'
import type { ConversationRepository } from '../application/ports'
import type { Conversation } from '../domain/message'

interface ConversationRow {
  id: string
  user_id: string
  title: string
  created_at: string
}

function toConversation(row: ConversationRow): Conversation {
  return { id: row.id, userId: row.user_id, title: row.title, createdAt: row.created_at }
}

export class SqliteConversationRepository implements ConversationRepository {
  async save(conversation: Conversation): Promise<void> {
    getDb()
      .prepare('INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)')
      .run(conversation.id, conversation.userId, conversation.title)
  }

  async findById(id: string, userId: string): Promise<Conversation | null> {
    const row = getDb()
      .prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
      .get(id, userId) as ConversationRow | undefined
    return row ? toConversation(row) : null
  }

  async listByUser(userId: string): Promise<Conversation[]> {
    const rows = getDb()
      .prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as ConversationRow[]
    return rows.map(toConversation)
  }
}
```

- [ ] **Step 6: Implement the document text lookup adapter (chat → documents boundary)**

```typescript
// src/modules/chat/infrastructure/document-text-lookup.ts
import { SqliteDocumentRepository } from '@/modules/documents/infrastructure/sqlite-document-repository'
import type { DocumentTextLookup } from '../application/ports'

export class SqliteDocumentTextLookup implements DocumentTextLookup {
  private readonly repo = new SqliteDocumentRepository()

  async getContentText(documentId: string, userId: string): Promise<string | null> {
    const doc = await this.repo.findById(documentId, userId)
    return doc?.contentText ?? null
  }
}
```

- [ ] **Step 7: Add the factory**

```typescript
// src/modules/chat/infrastructure/factory.ts
import { randomUUID } from 'node:crypto'
import { SendMessageUseCase } from '../application/send-message-use-case'
import { BuildContextUseCase } from '../application/build-context-use-case'
import { SqliteMessageRepository } from './sqlite-message-repository'
import { SqliteConversationRepository } from './sqlite-conversation-repository'
import { OpenRouterProvider } from './openrouter-provider'
import { SqliteDocumentTextLookup } from './document-text-lookup'

export function makeSendMessageUseCase(): SendMessageUseCase {
  const context = new BuildContextUseCase(new SqliteDocumentTextLookup())
  return new SendMessageUseCase(
    new SqliteMessageRepository(),
    new OpenRouterProvider(),
    { generate: () => randomUUID() },
    context
  )
}

export function makeConversationRepository(): SqliteConversationRepository {
  return new SqliteConversationRepository()
}

export function makeMessageRepository(): SqliteMessageRepository {
  return new SqliteMessageRepository()
}
```

- [ ] **Step 8: Commit**

```bash
git add src/modules/chat/infrastructure
git commit -m "feat(chat): add OpenRouter adapter, SQLite repos, cross-module document lookup"
```

---

### Task 9: Chat API route (non-streaming first) + conversations route

**Files:**
- Create: `src/app/api/chat/route.ts`
- Create: `src/app/api/conversations/route.ts`
- Create: `src/app/api/health/route.ts`

**Interfaces:**
- Consumes: `makeSendMessageUseCase`, `makeConversationRepository` (Task 8), `getUserId` helper pattern from Task 6 (duplicated here as a small shared helper — see Step 0).

- [ ] **Step 1: Extract the shared `getUserId` helper**

```typescript
// src/shared/auth/get-user-id.ts
import { makeVerifySessionUseCase, AUTH_COOKIE } from '@/modules/auth/infrastructure/factory'

export async function getUserId(request: Request): Promise<string | null> {
  const cookieHeader = request.headers.get('cookie') ?? ''
  const match = cookieHeader.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`))
  const token = match?.[1]
  const session = await makeVerifySessionUseCase().execute(token)
  return session?.userId ?? null
}
```

Then update `src/app/api/documents/route.ts` to import `getUserId` from `@/shared/auth/get-user-id` and delete the local copy defined in Task 6.

- [ ] **Step 2: Implement the conversations route**

```typescript
// src/app/api/conversations/route.ts
import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getUserId } from '@/shared/auth/get-user-id'
import { makeConversationRepository } from '@/modules/chat/infrastructure/factory'

export async function GET(request: Request) {
  const userId = await getUserId(request)
  if (!userId) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } }, { status: 401 })
  }
  const conversations = await makeConversationRepository().listByUser(userId)
  return NextResponse.json({ conversations })
}

const bodySchema = z.object({ title: z.string().min(1).max(200).optional() })

export async function POST(request: Request) {
  const userId = await getUserId(request)
  if (!userId) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } }, { status: 401 })
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
  const title = parsed.success && parsed.data.title ? parsed.data.title : 'New chat'

  const conversation = { id: randomUUID(), userId, title, createdAt: new Date().toISOString() }
  await makeConversationRepository().save(conversation)
  return NextResponse.json({ conversation })
}
```

- [ ] **Step 3: Implement the chat route (non-streaming)**

```typescript
// src/app/api/chat/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserId } from '@/shared/auth/get-user-id'
import { makeSendMessageUseCase } from '@/modules/chat/infrastructure/factory'

const bodySchema = z.object({
  conversationId: z.string().min(1),
  message: z.string().min(1).max(8000),
  documentId: z.string().min(1).optional(),
})

export async function POST(request: Request) {
  const userId = await getUserId(request)
  if (!userId) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } }, { status: 401 })
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'INVALID_BODY', message: 'Invalid chat request' } }, { status: 400 })
  }

  const result = await makeSendMessageUseCase().execute({
    userId,
    conversationId: parsed.data.conversationId,
    userMessage: parsed.data.message,
    documentId: parsed.data.documentId,
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

- [ ] **Step 4: Implement the health check route**

```typescript
// src/app/api/health/route.ts
import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ status: 'ok' })
}
```

- [ ] **Step 5: Manual verification**

Run: `pnpm dev`, log in, `POST /api/conversations` (via a quick `curl` with the session cookie) to create a conversation, then `POST /api/chat` with that `conversationId` and a message → expect a JSON reply and a token count. Confirm `messages` and `conversations` rows exist in `data/app.db`.

- [ ] **Step 6: Commit**

```bash
git add src/shared/auth src/app/api/chat src/app/api/conversations src/app/api/documents/route.ts src/app/api/health
git commit -m "feat(chat): add chat, conversations, and health routes"
```

---

### Task 10: Chat page UI (markdown, token usage, conversation history)

**Files:**
- Create: `src/app/chat/page.tsx`
- Create: `src/app/chat/chat-window.tsx`
- Create: `src/app/chat/conversation-sidebar.tsx`

**Interfaces:**
- Consumes: `/api/chat`, `/api/conversations`, `/api/documents` (GET, for picking a document to chat about).

- [ ] **Step 1: Build the conversation sidebar**

```tsx
// src/app/chat/conversation-sidebar.tsx
'use client'

interface ConversationSummary {
  id: string
  title: string
  createdAt: string
}

export function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
}: {
  conversations: ConversationSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}) {
  return (
    <aside className="w-64 shrink-0 border-r bg-gray-50 p-3">
      <button
        onClick={onNew}
        className="mb-3 w-full rounded bg-black px-3 py-2 text-sm text-white"
      >
        New chat
      </button>
      <ul className="space-y-1">
        {conversations.map((c) => (
          <li key={c.id}>
            <button
              onClick={() => onSelect(c.id)}
              className={`w-full truncate rounded px-2 py-1 text-left text-sm ${
                c.id === activeId ? 'bg-gray-200 font-medium' : 'hover:bg-gray-100'
              }`}
            >
              {c.title}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
```

- [ ] **Step 2: Build the chat window (markdown rendering + token usage)**

```tsx
// src/app/chat/chat-window.tsx
'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  tokenCount?: number
}

export function ChatWindow({
  conversationId,
  documentId,
}: {
  conversationId: string | null
  documentId: string | null
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionTokens, setSessionTokens] = useState(0)

  async function handleSend() {
    if (!input.trim() || !conversationId) return

    const userMessage = input
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setInput('')
    setSending(true)
    setError(null)

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, message: userMessage, documentId: documentId ?? undefined }),
    })

    const body = await response.json()
    setSending(false)

    if (!response.ok) {
      setError(body.error?.message ?? 'Something went wrong')
      return
    }

    setMessages((prev) => [...prev, { role: 'assistant', content: body.reply, tokenCount: body.tokenCount }])
    setSessionTokens((prev) => prev + body.tokenCount)
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between border-b p-3 text-sm text-gray-600">
        <span>{documentId ? 'Chatting about uploaded document' : 'General chat'}</span>
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

      <div className="flex gap-2 border-t p-3">
        <input
          className="flex-1 rounded border px-3 py-2 text-sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask something…"
          disabled={!conversationId || sending}
        />
        <button
          onClick={handleSend}
          disabled={!conversationId || sending}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Build the page that wires sidebar + window + document picker together**

```tsx
// src/app/chat/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { ConversationSidebar } from './conversation-sidebar'
import { ChatWindow } from './chat-window'

interface ConversationSummary {
  id: string
  title: string
  createdAt: string
}

interface DocumentSummary {
  id: string
  filename: string
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [documentId, setDocumentId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/conversations')
      .then((r) => r.json())
      .then((body) => setConversations(body.conversations ?? []))

    fetch('/api/documents')
      .then((r) => r.json())
      .then((body) => setDocuments(body.documents ?? []))
  }, [])

  async function handleNew() {
    const response = await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const body = await response.json()
    setConversations((prev) => [body.conversation, ...prev])
    setActiveId(body.conversation.id)
  }

  return (
    <div className="flex h-screen">
      <ConversationSidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={handleNew}
      />
      <div className="flex flex-1 flex-col">
        <div className="border-b p-3 text-sm">
          <label className="mr-2 font-medium">Document context:</label>
          <select
            className="rounded border px-2 py-1"
            value={documentId ?? ''}
            onChange={(e) => setDocumentId(e.target.value || null)}
          >
            <option value="">None</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.filename}
              </option>
            ))}
          </select>
        </div>
        <ChatWindow conversationId={activeId} documentId={documentId} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Manual verification**

Run: `pnpm dev`, log in, click "New chat", send a message → expect a markdown-rendered reply and a growing session token counter. Select an uploaded document from the dropdown, ask a question about its content → expect an answer grounded in that document.

- [ ] **Step 5: Commit**

```bash
git add src/app/chat
git commit -m "feat(chat): add chat page with markdown rendering, sidebar, document context picker"
```

---

### Task 11: Streaming response

**Files:**
- Modify: `src/modules/chat/application/ports.ts` (add `AiProvider.completeStream`)
- Modify: `src/modules/chat/infrastructure/openrouter-provider.ts` (implement `completeStream`)
- Create: `src/app/api/chat/stream/route.ts`
- Modify: `src/app/chat/chat-window.tsx` (read the stream)

**Interfaces:**
- Produces: `AiProvider.completeStream(input): AsyncIterable<{ delta: string } | { done: true; tokenCount: number }>`, consumed only by `src/app/api/chat/stream/route.ts` (the non-streaming `SendMessageUseCase` path from Task 7 stays as the source of truth for message persistence and is reused here for saving once the stream ends).

- [ ] **Step 1: Add `completeStream` to the `AiProvider` port**

Replace the existing `AiProvider` interface in `ports.ts` (defined in Task 7, Step 2) with this version — do not leave the old declaration in place, it would collide with this one:

```typescript
// src/modules/chat/application/ports.ts (replace the AiProvider interface)
export interface StreamChunk {
  delta: string
  done: boolean
  tokenCount?: number
}

export interface AiProvider {
  complete(input: {
    systemPrompt?: string
    messages: { role: 'user' | 'assistant'; content: string }[]
  }): Promise<{ content: string; tokenCount: number }>

  completeStream(input: {
    systemPrompt?: string
    messages: { role: 'user' | 'assistant'; content: string }[]
  }): AsyncIterable<StreamChunk>
}
```

- [ ] **Step 2: Implement `completeStream` on `OpenRouterProvider`**

```typescript
// src/modules/chat/infrastructure/openrouter-provider.ts (append inside the class)
async *completeStream(input: {
  systemPrompt?: string
  messages: { role: 'user' | 'assistant'; content: string }[]
}): AsyncIterable<import('../application/ports').StreamChunk> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set')

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        ...(input.systemPrompt ? [{ role: 'system', content: input.systemPrompt }] : []),
        ...input.messages,
      ],
    }),
  })

  if (!response.ok || !response.body) {
    throw new Error(`OpenRouter stream error: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''
  let tokenCount = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') continue

      const json = JSON.parse(payload)
      const delta: string = json.choices?.[0]?.delta?.content ?? ''
      if (json.usage?.total_tokens) tokenCount = json.usage.total_tokens
      if (delta) {
        fullContent += delta
        yield { delta, done: false }
      }
    }
  }

  // Fallback if the provider never sent usage in the stream
  if (!tokenCount) tokenCount = Math.ceil(fullContent.length / 4)
  yield { delta: '', done: true, tokenCount }
}
```

- [ ] **Step 3: Implement the streaming route**

This route re-implements message persistence directly (rather than calling `SendMessageUseCase`, which is request/response-shaped) but reuses `BuildContextUseCase` and the same repositories for consistency.

```typescript
// src/app/api/chat/stream/route.ts
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { getUserId } from '@/shared/auth/get-user-id'
import { makeMessageRepository } from '@/modules/chat/infrastructure/factory'
import { OpenRouterProvider } from '@/modules/chat/infrastructure/openrouter-provider'
import { SqliteDocumentTextLookup } from '@/modules/chat/infrastructure/document-text-lookup'
import { BuildContextUseCase } from '@/modules/chat/application/build-context-use-case'

const bodySchema = z.object({
  conversationId: z.string().min(1),
  message: z.string().min(1).max(8000),
  documentId: z.string().min(1).optional(),
})

export async function POST(request: Request) {
  const userId = await getUserId(request)
  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return new Response('Invalid request', { status: 400 })
  }

  const { conversationId, message, documentId } = parsed.data
  const messages = makeMessageRepository()
  const history = await messages.listByConversation(conversationId)
  const context = new BuildContextUseCase(new SqliteDocumentTextLookup())
  const systemPrompt = await context.execute({ userId, documentId })

  await messages.save({
    id: randomUUID(),
    conversationId,
    role: 'user',
    content: message,
    tokenCount: 0,
    createdAt: new Date().toISOString(),
  })

  const provider = new OpenRouterProvider()

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      let fullContent = ''
      let tokenCount = 0

      try {
        for await (const chunk of provider.completeStream({
          systemPrompt: systemPrompt ?? undefined,
          messages: [
            ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
            { role: 'user', content: message },
          ],
        })) {
          if (chunk.done) {
            tokenCount = chunk.tokenCount ?? 0
          } else {
            fullContent += chunk.delta
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: chunk.delta })}\n\n`))
          }
        }

        await messages.save({
          id: randomUUID(),
          conversationId,
          role: 'assistant',
          content: fullContent,
          tokenCount,
          createdAt: new Date().toISOString(),
        })

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, tokenCount })}\n\n`))
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

- [ ] **Step 4: Wire the chat window to the streaming endpoint**

Replace the `handleSend` body in `src/app/chat/chat-window.tsx` with a streaming reader:

```tsx
async function handleSend() {
  if (!input.trim() || !conversationId) return

  const userMessage = input
  setMessages((prev) => [...prev, { role: 'user', content: userMessage }, { role: 'assistant', content: '' }])
  setInput('')
  setSending(true)
  setError(null)

  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, message: userMessage, documentId: documentId ?? undefined }),
  })

  if (!response.ok || !response.body) {
    setSending(false)
    setError('Something went wrong')
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
      const event = JSON.parse(line.slice(5).trim())

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
        setSessionTokens((prev) => prev + event.tokenCount)
      }
    }
  }

  setSending(false)
}
```

- [ ] **Step 5: Manual verification**

Run: `pnpm dev`, send a chat message → expect the assistant bubble to fill in incrementally instead of appearing all at once, with a final token count.

- [ ] **Step 6: Commit**

```bash
git add src/modules/chat/application/ports.ts src/modules/chat/infrastructure/openrouter-provider.ts src/app/api/chat/stream src/app/chat/chat-window.tsx
git commit -m "feat(chat): add streaming chat endpoint and incremental UI rendering"
```

---

### Task 12: Rate limiting

**Files:**
- Create: `src/shared/rate-limit/token-bucket.ts`
- Test: `src/shared/rate-limit/token-bucket.test.ts`
- Modify: `src/app/api/chat/route.ts` and `src/app/api/chat/stream/route.ts` (apply the limiter)

**Interfaces:**
- Produces: `TokenBucketLimiter.tryConsume(key: string): { allowed: boolean; retryAfterSeconds: number }`, used by both chat routes.

- [ ] **Step 1: Write the failing test**

```typescript
// src/shared/rate-limit/token-bucket.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TokenBucketLimiter } from './token-bucket'

describe('TokenBucketLimiter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('allows requests up to the limit then blocks', () => {
    const limiter = new TokenBucketLimiter({ maxRequests: 2, windowMs: 60_000 })
    expect(limiter.tryConsume('user-1').allowed).toBe(true)
    expect(limiter.tryConsume('user-1').allowed).toBe(true)
    const third = limiter.tryConsume('user-1')
    expect(third.allowed).toBe(false)
    expect(third.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('tracks separate buckets per key', () => {
    const limiter = new TokenBucketLimiter({ maxRequests: 1, windowMs: 60_000 })
    expect(limiter.tryConsume('user-1').allowed).toBe(true)
    expect(limiter.tryConsume('user-2').allowed).toBe(true)
  })

  it('resets after the window passes', () => {
    const limiter = new TokenBucketLimiter({ maxRequests: 1, windowMs: 60_000 })
    expect(limiter.tryConsume('user-1').allowed).toBe(true)
    vi.advanceTimersByTime(61_000)
    expect(limiter.tryConsume('user-1').allowed).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/shared/rate-limit/token-bucket.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `TokenBucketLimiter`**

```typescript
// src/shared/rate-limit/token-bucket.ts
interface Bucket {
  count: number
  windowStart: number
}

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>()
  private readonly maxRequests: number
  private readonly windowMs: number

  constructor(options: { maxRequests: number; windowMs: number }) {
    this.maxRequests = options.maxRequests
    this.windowMs = options.windowMs
  }

  tryConsume(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now()
    const bucket = this.buckets.get(key)

    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: now })
      return { allowed: true, retryAfterSeconds: 0 }
    }

    if (bucket.count < this.maxRequests) {
      bucket.count += 1
      return { allowed: true, retryAfterSeconds: 0 }
    }

    const retryAfterSeconds = Math.ceil((bucket.windowStart + this.windowMs - now) / 1000)
    return { allowed: false, retryAfterSeconds }
  }
}

// Module-level singleton so both chat routes share the same limiter state
export const chatRateLimiter = new TokenBucketLimiter({ maxRequests: 10, windowMs: 60_000 })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/shared/rate-limit/token-bucket.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Apply the limiter in `src/app/api/chat/route.ts`**

Add right after the `userId` check:

```typescript
import { chatRateLimiter } from '@/shared/rate-limit/token-bucket'

// ...inside POST, after confirming userId:
const limit = chatRateLimiter.tryConsume(userId)
if (!limit.allowed) {
  return NextResponse.json(
    { error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down' } },
    { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
  )
}
```

- [ ] **Step 6: Apply the same check in `src/app/api/chat/stream/route.ts`**

Add right after the `userId` check:

```typescript
import { chatRateLimiter } from '@/shared/rate-limit/token-bucket'

// ...inside POST, after confirming userId:
const limit = chatRateLimiter.tryConsume(userId)
if (!limit.allowed) {
  return new Response('Too many requests', { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } })
}
```

- [ ] **Step 7: Commit**

```bash
git add src/shared/rate-limit src/app/api/chat/route.ts src/app/api/chat/stream/route.ts
git commit -m "feat(chat): add per-user rate limiting on chat endpoints"
```

---

### Task 13: Docker, healthcheck wiring, env plumbing

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Modify: `next.config.ts` (enable `output: 'standalone'`)

**Interfaces:**
- Consumes: `/api/health` from Task 9.

- [ ] **Step 1: Enable standalone output**

Add to `next.config.ts`:

```typescript
const nextConfig: NextConfig = {
  output: 'standalone',
  // ...keep any existing config here
}
```

- [ ] **Step 2: Write the Dockerfile**

```dockerfile
# Dockerfile
FROM node:20-slim AS base
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/src/shared/db/schema.sql ./src/shared/db/schema.sql

EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 3: Write `docker-compose.yml`**

```yaml
# docker-compose.yml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
      - JWT_SECRET=${JWT_SECRET}
      - DATABASE_PATH=/app/data/app.db
    volumes:
      - db-data:/app/data
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  db-data:
```

- [ ] **Step 4: Manual verification**

Run: `cp .env.example .env` (fill in `OPENROUTER_API_KEY`), then `docker compose up --build`. Expect the container to become healthy (`docker compose ps` shows `healthy`) and `curl http://localhost:3000/api/health` to return `{"status":"ok"}`. Log in through the browser at `http://localhost:3000/login` and confirm chat/upload still work.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml next.config.ts
git commit -m "chore: add Docker Compose deployment with healthcheck"
```

---

### Task 14: Documentation deliverables

**Files:**
- Modify: `README.md`
- Create: `DECISIONS.md`
- Verify: `AI_JOURNAL.md` (should already have been updated incrementally during Tasks 1–13 — this task only reviews and finalizes it)

**Interfaces:** None — documentation only.

- [ ] **Step 1: Rewrite `README.md`**

Cover, at minimum: Tech Stack (Next.js 16.3, SQLite, OpenRouter, no vector DB — explain why in Architecture), Setup & Run (`cp .env.example .env` then `docker compose up`), Features Done checklist (mirror the required + extra features actually implemented), Architecture (the clean-architecture module layout from the design spec, one paragraph), Known Issues (be honest — e.g. rate limiter resets on restart since it's in-memory, large PDFs get truncated rather than chunked).

- [ ] **Step 2: Write `DECISIONS.md`**

Three entries, each 100–200 words, each with Context / Alternatives Considered / Why / Trade-offs:
1. SQLite over PostgreSQL
2. Full-context injection instead of RAG
3. Clean architecture module structure over a flat layering

- [ ] **Step 3: Review `AI_JOURNAL.md` for completeness**

Confirm every session that used AI assistance during Tasks 1–13 has an entry with Prompt / AI Response summary / My Adjustment. Fill any gaps from memory now if a session was missed — but the bulk of it should already exist from writing it alongside the work.

- [ ] **Step 4: Commit**

```bash
git add README.md DECISIONS.md AI_JOURNAL.md
git commit -m "docs: finalize README, decisions log, and AI usage journal"
```

---

### Task 15: Full test suite + coverage check

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (add `"test"` and `"test:coverage"` scripts)

**Interfaces:** None — verification only.

- [ ] **Step 1: Add `vitest.config.ts`**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/modules/**/application/**', 'src/shared/**'],
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
```

- [ ] **Step 2: Add scripts to `package.json`**

```json
"test": "vitest run",
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 3: Run the full suite**

Run: `pnpm test`
Expected: all tests from Tasks 1, 2, 5, 7, 8, 12 pass.

- [ ] **Step 4: Run coverage and confirm ≥40% on `application/` + `shared/`**

Run: `pnpm test:coverage`
Expected: coverage summary shows ≥40% line coverage for the included paths. If below, add missing test cases for any untested branch in the use-cases (e.g. an untested error path) rather than lowering the threshold.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json pnpm-lock.yaml
git commit -m "test: add vitest config and coverage scripts"
```

---

## Post-plan checklist (not a task — verify before calling Part 1 done)

- [ ] `docker compose up` starts the app from a clean clone with just `.env` filled in
- [ ] Login → chat → upload → chat-with-document → logout all work end to end in the browser
- [ ] `pnpm test:coverage` shows ≥40% on the covered paths
- [ ] README, DECISIONS.md, AI_JOURNAL.md all present and filled in (not templates)
- [ ] `git log --oneline` shows the incremental history from this plan, not a single squashed commit
