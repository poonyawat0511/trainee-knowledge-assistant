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
