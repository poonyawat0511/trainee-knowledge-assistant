import { describe, it, expect, vi } from 'vitest'
import { BuildContextUseCase } from './build-context-use-case'
import type { DocumentTextLookup } from './ports'

describe('BuildContextUseCase', () => {
  it('returns null when the conversation has no documents and no documentId is given', async () => {
    const lookup: DocumentTextLookup = { listContentTexts: vi.fn(async () => []), getContentText: vi.fn(async () => null) }
    const useCase = new BuildContextUseCase(lookup)
    expect(await useCase.execute({ userId: 'u1', conversationId: 'c1' })).toBeNull()
  })

  it('returns a system prompt built from a single document', async () => {
    const lookup: DocumentTextLookup = {
      listContentTexts: vi.fn(async () => ['The quick brown fox']),
      getContentText: vi.fn(async () => null),
    }
    const useCase = new BuildContextUseCase(lookup)
    const prompt = await useCase.execute({ userId: 'u1', conversationId: 'c1' })
    expect(prompt).toContain('The quick brown fox')
  })

  it('concatenates text from multiple documents into one prompt', async () => {
    const lookup: DocumentTextLookup = {
      listContentTexts: vi.fn(async () => ['first document text', 'second document text']),
      getContentText: vi.fn(async () => null),
    }
    const useCase = new BuildContextUseCase(lookup)
    const prompt = await useCase.execute({ userId: 'u1', conversationId: 'c1' })
    expect(prompt).toContain('first document text')
    expect(prompt).toContain('second document text')
  })

  it('truncates the combined content that exceeds the token budget', async () => {
    const longText = 'a'.repeat(50_000)
    const lookup: DocumentTextLookup = {
      listContentTexts: vi.fn(async () => [longText, longText]),
      getContentText: vi.fn(async () => null),
    }
    const useCase = new BuildContextUseCase(lookup, { maxChars: 1000 })
    const prompt = await useCase.execute({ userId: 'u1', conversationId: 'c1' })
    expect(prompt!.length).toBeLessThan(1200)
  })

  it('includes an explicitly selected document even when the conversation has none of its own', async () => {
    const lookup: DocumentTextLookup = {
      listContentTexts: vi.fn(async () => []),
      getContentText: vi.fn(async () => 'explicitly selected document text'),
    }
    const useCase = new BuildContextUseCase(lookup)
    const prompt = await useCase.execute({ userId: 'u1', conversationId: 'c1', documentId: 'doc-1' })
    expect(prompt).toContain('explicitly selected document text')
    expect(lookup.getContentText).toHaveBeenCalledWith('doc-1', 'u1')
  })

  it('combines the conversation documents with an explicitly selected document', async () => {
    const lookup: DocumentTextLookup = {
      listContentTexts: vi.fn(async () => ['conversation document text']),
      getContentText: vi.fn(async () => 'explicitly selected document text'),
    }
    const useCase = new BuildContextUseCase(lookup)
    const prompt = await useCase.execute({ userId: 'u1', conversationId: 'c1', documentId: 'doc-1' })
    expect(prompt).toContain('conversation document text')
    expect(prompt).toContain('explicitly selected document text')
  })

  it('does not duplicate an explicitly selected document already attached to the conversation', async () => {
    const lookup: DocumentTextLookup = {
      listContentTexts: vi.fn(async () => ['same text']),
      getContentText: vi.fn(async () => 'same text'),
    }
    const useCase = new BuildContextUseCase(lookup)
    const prompt = await useCase.execute({ userId: 'u1', conversationId: 'c1', documentId: 'doc-1' })
    const occurrences = prompt!.split('same text').length - 1
    expect(occurrences).toBe(1)
  })
})
