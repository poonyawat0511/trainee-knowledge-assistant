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
    const db = await getDb()
    const row = db
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
