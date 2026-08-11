import { describe, it, expect, vi } from 'vitest'
import { BuildContextUseCase } from './build-context-use-case'
import type { DocumentTextLookup } from './ports'

describe('BuildContextUseCase', () => {
  it('returns null when no documentId is given', async () => {
    const lookup: DocumentTextLookup = { getContentText: vi.fn() }
    const useCase = new BuildContextUseCase(lookup)
    expect(await useCase.execute({ userId: 'u1' })).toBeNull()
    expect(lookup.getContentText).not.toHaveBeenCalled()
  })

  it('returns a system prompt built from the document text', async () => {
    const lookup: DocumentTextLookup = {
      getContentText: vi.fn(async () => 'The quick brown fox'),
    }
    const useCase = new BuildContextUseCase(lookup)
    const prompt = await useCase.execute({ userId: 'u1', documentId: 'doc-1' })
    expect(prompt).toContain('The quick brown fox')
  })

  it('truncates content that exceeds the token budget', async () => {
    const longText = 'a'.repeat(50_000)
    const lookup: DocumentTextLookup = { getContentText: vi.fn(async () => longText) }
    const useCase = new BuildContextUseCase(lookup, { maxChars: 1000 })
    const prompt = await useCase.execute({ userId: 'u1', documentId: 'doc-1' })
    expect(prompt!.length).toBeLessThan(1200)
  })

  it('returns null when the document is not found', async () => {
    const lookup: DocumentTextLookup = { getContentText: vi.fn(async () => null) }
    const useCase = new BuildContextUseCase(lookup)
    expect(await useCase.execute({ userId: 'u1', documentId: 'missing' })).toBeNull()
  })
})
