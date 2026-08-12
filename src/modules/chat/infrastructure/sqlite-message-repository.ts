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
    const db = await getDb()
    db
      .prepare(
        `INSERT INTO messages (id, conversation_id, role, content, token_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        message.id,
        message.conversationId,
        message.role,
        message.content,
        message.tokenCount,
        message.createdAt
      )
  }

  async listByConversation(conversationId: string): Promise<Message[]> {
    const db = await getDb()
    const rows = db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
      .all(conversationId) as unknown as MessageRow[]
    return rows.map(toMessage)
  }

  async totalTokensForConversation(conversationId: string): Promise<number> {
    const db = await getDb()
    const row = db
      .prepare('SELECT COALESCE(SUM(token_count), 0) as total FROM messages WHERE conversation_id = ?')
      .get(conversationId) as { total: number }
    return row.total
  }
}
