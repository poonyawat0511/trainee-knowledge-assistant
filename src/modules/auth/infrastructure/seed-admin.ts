import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { getDb } from '@/shared/db/client'

export async function seedAdmin(): Promise<void> {
  const db = await getDb()
  const existing = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get('admin')

  if (existing) return

  const passwordHash = await bcrypt.hash('admin123', 10)
  db.prepare(
    'INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)'
  ).run(randomUUID(), 'admin', passwordHash)
}
