import { describe, it, expect, vi } from 'vitest'
import { BuildContextUseCase } from './build-context-use-case'
import type { DocumentTextLookup } from './ports'

describe('BuildContextUseCase', () => {
  it('returns null when the conversation has no documents', async () => {
    const lookup: DocumentTextLookup = { listContentTexts: vi.fn(async () => []) }
    const useCase = new BuildContextUseCase(lookup)
    expect(await useCase.execute({ userId: 'u1', conversationId: 'c1' })).toBeNull()
  })

  it('returns a system prompt built from a single document', async () => {
    const lookup: DocumentTextLookup = { listContentTexts: vi.fn(async () => ['The quick brown fox']) }
    const useCase = new BuildContextUseCase(lookup)
    const prompt = await useCase.execute({ userId: 'u1', conversationId: 'c1' })
    expect(prompt).toContain('The quick brown fox')
  })

  it('concatenates text from multiple documents into one prompt', async () => {
    const lookup: DocumentTextLookup = {
      listContentTexts: vi.fn(async () => ['first document text', 'second document text']),
    }
    const useCase = new BuildContextUseCase(lookup)
    const prompt = await useCase.execute({ userId: 'u1', conversationId: 'c1' })
    expect(prompt).toContain('first document text')
    expect(prompt).toContain('second document text')
  })

  it('truncates the combined content that exceeds the token budget', async () => {
    const longText = 'a'.repeat(50_000)
    const lookup: DocumentTextLookup = { listContentTexts: vi.fn(async () => [longText, longText]) }
    const useCase = new BuildContextUseCase(lookup, { maxChars: 1000 })
    const prompt = await useCase.execute({ userId: 'u1', conversationId: 'c1' })
    expect(prompt!.length).toBeLessThan(1200)
  })
})
