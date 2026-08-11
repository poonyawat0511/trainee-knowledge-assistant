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
