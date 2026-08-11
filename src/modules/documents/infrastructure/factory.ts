import { randomUUID } from 'node:crypto'
import { UploadDocumentUseCase } from '../application/upload-document-use-case'
import { SqliteDocumentRepository } from './sqlite-document-repository'
import { PdfTextExtractor } from './pdf-text-extractor'

export function makeUploadDocumentUseCase(): UploadDocumentUseCase {
  return new UploadDocumentUseCase(
    new SqliteDocumentRepository(),
    new PdfTextExtractor(),
    { generate: () => randomUUID() }
  )
}

export function makeDocumentRepository(): SqliteDocumentRepository {
  return new SqliteDocumentRepository()
}
