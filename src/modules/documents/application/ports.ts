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
