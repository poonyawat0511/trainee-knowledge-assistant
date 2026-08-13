import { describe, it, expect, vi } from 'vitest'
import { SendMessageUseCase } from './send-message-use-case'
import { BuildContextUseCase } from './build-context-use-case'
import type { MessageRepository, AiProvider, IdGenerator, DocumentTextLookup } from './ports'

function makeUseCase(overrides: { ai?: Partial<AiProvider> } = {}) {
  const messages: MessageRepository = {
    save: vi.fn(async () => {}),
    listByConversation: vi.fn(async () => []),
  }
  const ai: AiProvider = {
    complete: vi.fn(async () => ({ content: 'Hello back', tokenCount: 12 })),
    completeStream: vi.fn(async function* () {}),
    ...overrides.ai,
  }
  const ids: IdGenerator = { generate: vi.fn(() => 'msg-1') }
  const lookup: DocumentTextLookup = { listContentTexts: vi.fn(async () => []), getContentText: vi.fn(async () => null) }
  const context = new BuildContextUseCase(lookup)
  const useCase = new SendMessageUseCase(messages, ai, ids, context)
  return { useCase, messages, ai }
}

describe('SendMessageUseCase', () => {
  it('saves the user message and the AI reply, returning the reply', async () => {
    const { useCase, messages, ai } = makeUseCase()

    const result = await useCase.execute({
      userId: 'u1',
      conversationId: 'c1',
      userMessage: 'hi',
    })

    expect(result).toEqual({ ok: true, value: { reply: 'Hello back', tokenCount: 12 } })
    expect(messages.save).toHaveBeenCalledTimes(2)
    expect(messages.save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ role: 'user', content: 'hi', tokenCount: 1 })
    )
    expect(ai.complete).toHaveBeenCalledOnce()
  })

  it('returns AI_PROVIDER_ERROR when the provider throws', async () => {
    const { useCase } = makeUseCase({
      ai: { complete: vi.fn(async () => { throw new Error('timeout') }) },
    })

    const result = await useCase.execute({
      userId: 'u1',
      conversationId: 'c1',
      userMessage: 'hi',
    })

    expect(result).toEqual({ ok: false, error: 'AI_PROVIDER_ERROR' })
  })
})
