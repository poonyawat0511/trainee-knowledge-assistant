import { describe, it, expect, vi } from 'vitest'
import { StreamMessageUseCase } from './stream-message-use-case'
import { BuildContextUseCase } from './build-context-use-case'
import type { MessageRepository, AiProvider, IdGenerator, DocumentTextLookup, StreamChunk } from './ports'

function makeUseCase(overrides: { ai?: Partial<AiProvider> } = {}) {
  const messages: MessageRepository = {
    save: vi.fn(async () => {}),
    listByConversation: vi.fn(async () => []),
  }
  const ai: AiProvider = {
    complete: vi.fn(async () => ({ content: 'unused', tokenCount: 0 })),
    completeStream: vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      yield { delta: 'Hello', done: false }
      yield { delta: ' back', done: false }
      yield { delta: '', done: true, tokenCount: 12 }
    }),
    ...overrides.ai,
  }
  const ids: IdGenerator = { generate: vi.fn(() => 'msg-1') }
  const lookup: DocumentTextLookup = { listContentTexts: vi.fn(async () => []) }
  const context = new BuildContextUseCase(lookup)
  const useCase = new StreamMessageUseCase(messages, ai, ids, context)
  return { useCase, messages, ai }
}

async function drain(iterable: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

describe('StreamMessageUseCase', () => {
  it('saves the user message before streaming, yields chunks, and saves the full assistant reply after completion', async () => {
    const { useCase, messages, ai } = makeUseCase()

    const chunks = await drain(
      useCase.execute({ userId: 'u1', conversationId: 'c1', userMessage: 'hi' })
    )

    expect(chunks).toEqual([
      { delta: 'Hello', done: false },
      { delta: ' back', done: false },
      { delta: '', done: true, tokenCount: 12 },
    ])
    expect(ai.completeStream).toHaveBeenCalledOnce()
    expect(messages.save).toHaveBeenCalledTimes(2)
    expect(messages.save).toHaveBeenNthCalledWith(1, expect.objectContaining({ role: 'user', content: 'hi' }))
    expect(messages.save).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ role: 'assistant', content: 'Hello back', tokenCount: 12 })
    )
  })

  it('saves the user message but not the assistant reply when the provider stream throws', async () => {
    const { useCase, messages } = makeUseCase({
      ai: {
        completeStream: vi.fn(async function* (): AsyncGenerator<StreamChunk> {
          yield { delta: 'partial', done: false }
          throw new Error('connection dropped')
        }),
      },
    })

    await expect(drain(useCase.execute({ userId: 'u1', conversationId: 'c1', userMessage: 'hi' }))).rejects.toThrow(
      'connection dropped'
    )

    expect(messages.save).toHaveBeenCalledTimes(1)
    expect(messages.save).toHaveBeenCalledWith(expect.objectContaining({ role: 'user', content: 'hi' }))
  })
})
