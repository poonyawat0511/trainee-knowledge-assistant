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
    const db = await getDb()
    db
      .prepare('INSERT INTO conversations (id, user_id, title, created_at) VALUES (?, ?, ?, ?)')
      .run(conversation.id, conversation.userId, conversation.title, conversation.createdAt)
  }

  async findById(id: string, userId: string): Promise<Conversation | null> {
    const db = await getDb()
    const row = db
      .prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
      .get(id, userId) as ConversationRow | undefined
    return row ? toConversation(row) : null
  }

  async listByUser(userId: string): Promise<Conversation[]> {
    const db = await getDb()
    const rows = db
      .prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as unknown as ConversationRow[]
    return rows.map(toConversation)
  }
}
