import { ok, err, type Result } from '@/shared/kernel/result'
import type { Document } from '../domain/document'
import type { DocumentRepository, TextExtractor, IdGenerator } from './ports'

const ALLOWED_TYPES = ['application/pdf', 'text/plain']
const MAX_BYTES = 10 * 1024 * 1024

export class UploadDocumentUseCase {
  constructor(
    private readonly repo: DocumentRepository,
    private readonly extractor: TextExtractor,
    private readonly ids: IdGenerator
  ) {}

  async execute(input: {
    userId: string
    filename: string
    mimeType: string
    buffer: Buffer
  }): Promise<Result<Document, 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'EMPTY_FILE'>> {
    if (!ALLOWED_TYPES.includes(input.mimeType)) {
      return err('UNSUPPORTED_TYPE')
    }
    if (input.buffer.byteLength > MAX_BYTES) {
      return err('TOO_LARGE')
    }

    const contentText = (await this.extractor.extract(input.buffer, input.mimeType)).trim()
    if (contentText.length === 0) {
      return err('EMPTY_FILE')
    }

    const doc: Document = {
      id: this.ids.generate(),
      userId: input.userId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.byteLength,
      contentText,
      createdAt: new Date().toISOString(),
    }

    await this.repo.save(doc)
    return ok(doc)
  }
}
