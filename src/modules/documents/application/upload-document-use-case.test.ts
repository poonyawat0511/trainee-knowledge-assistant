import { describe, it, expect, vi } from 'vitest'
import { UploadDocumentUseCase } from './upload-document-use-case'
import type { DocumentRepository, TextExtractor, IdGenerator } from './ports'

const MAX_BYTES = 10 * 1024 * 1024

function makeUseCase(overrides: {
  repo?: Partial<DocumentRepository>
  extractor?: Partial<TextExtractor>
  ids?: Partial<IdGenerator>
} = {}) {
  const repo: DocumentRepository = {
    save: vi.fn(async () => {}),
    findById: vi.fn(async () => null),
    listByConversation: vi.fn(async () => []),
    listByUser: vi.fn(async () => []),
    ...overrides.repo,
  }
  const extractor: TextExtractor = {
    extract: vi.fn(async () => 'extracted text'),
    ...overrides.extractor,
  }
  const ids: IdGenerator = { generate: vi.fn(() => 'doc-1'), ...overrides.ids }
  return { useCase: new UploadDocumentUseCase(repo, extractor, ids), repo, extractor }
}

describe('UploadDocumentUseCase', () => {
  it('rejects unsupported mime types', async () => {
    const { useCase } = makeUseCase()
    const result = await useCase.execute({
      userId: 'u1',
      conversationId: 'conv-1',
      filename: 'x.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('data'),
    })
    expect(result).toEqual({ ok: false, error: 'UNSUPPORTED_TYPE' })
  })

  it('rejects files over the size limit', async () => {
    const { useCase } = makeUseCase()
    const result = await useCase.execute({
      userId: 'u1',
      conversationId: 'conv-1',
      filename: 'big.txt',
      mimeType: 'text/plain',
      buffer: Buffer.alloc(MAX_BYTES + 1),
    })
    expect(result).toEqual({ ok: false, error: 'TOO_LARGE' })
  })

  it('rejects files that extract to empty text', async () => {
    const { useCase } = makeUseCase({ extractor: { extract: vi.fn(async () => '   ') } })
    const result = await useCase.execute({
      userId: 'u1',
      conversationId: 'conv-1',
      filename: 'empty.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(''),
    })
    expect(result).toEqual({ ok: false, error: 'EMPTY_FILE' })
  })

  it('saves and returns the document, linked to the given conversation', async () => {
    const { useCase, repo } = makeUseCase()
    const result = await useCase.execute({
      userId: 'u1',
      conversationId: 'conv-1',
      filename: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello world'),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.id).toBe('doc-1')
      expect(result.value.contentText).toBe('extracted text')
      expect(result.value.conversationId).toBe('conv-1')
    }
    expect(repo.save).toHaveBeenCalledOnce()
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv-1' }))
  })
})
