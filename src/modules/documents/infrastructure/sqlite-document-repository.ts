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
        `INSERT INTO documents (id, user_id, filename, mime_type, size_bytes, content_text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(doc.id, doc.userId, doc.filename, doc.mimeType, doc.sizeBytes, doc.contentText, doc.createdAt)
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
