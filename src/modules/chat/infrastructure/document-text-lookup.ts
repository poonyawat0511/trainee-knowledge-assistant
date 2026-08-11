import { SqliteDocumentRepository } from '@/modules/documents/infrastructure/sqlite-document-repository'
import type { DocumentTextLookup } from '../application/ports'

export class SqliteDocumentTextLookup implements DocumentTextLookup {
  private readonly repo = new SqliteDocumentRepository()

  async getContentText(documentId: string, userId: string): Promise<string | null> {
    const doc = await this.repo.findById(documentId, userId)
    return doc?.contentText ?? null
  }
}
