import type { Document } from '../domain/document'

export interface DocumentRepository {
  save(doc: Document): Promise<void>
  findById(id: string, userId: string): Promise<Document | null>
  listByConversation(conversationId: string, userId: string): Promise<Document[]>
  listByUser(userId: string): Promise<Document[]>
}

export interface TextExtractor {
  extract(buffer: Buffer, mimeType: string): Promise<string>
}

export interface IdGenerator {
  generate(): string
}
