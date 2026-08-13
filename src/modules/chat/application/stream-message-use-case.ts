import { estimateTokenCount } from '@/shared/kernel/estimate-token-count'
import type { Message } from '../domain/message'
import type { MessageRepository, AiProvider, IdGenerator, StreamChunk } from './ports'
import type { BuildContextUseCase } from './build-context-use-case'

/**
 * Streams an AI reply chunk-by-chunk while owning the same persistence
 * sequence as SendMessageUseCase: the user message is saved BEFORE calling
 * the AI, and the assistant message is saved only after the stream
 * completes successfully. If the stream throws partway through, the
 * assistant message is NOT persisted (matching prior route behavior — a
 * known limitation, not something this use case tries to fix).
 */
export class StreamMessageUseCase {
  constructor(
    private readonly messages: MessageRepository,
    private readonly ai: AiProvider,
    private readonly ids: IdGenerator,
    private readonly buildContext: BuildContextUseCase
  ) {}

  async *execute(input: {
    userId: string
    conversationId: string
    userMessage: string
    documentId?: string
  }): AsyncGenerator<StreamChunk> {
    const history = await this.messages.listByConversation(input.conversationId)
    const systemPrompt = await this.buildContext.execute({
      userId: input.userId,
      conversationId: input.conversationId,
      documentId: input.documentId,
    })

    const userMsg: Message = {
      id: this.ids.generate(),
      conversationId: input.conversationId,
      role: 'user',
      content: input.userMessage,
      tokenCount: estimateTokenCount(input.userMessage),
      createdAt: new Date().toISOString(),
    }
    await this.messages.save(userMsg)

    let fullContent = ''
    let tokenCount = 0

    for await (const chunk of this.ai.completeStream({
      systemPrompt: systemPrompt ?? undefined,
      messages: [
        ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user', content: input.userMessage },
      ],
    })) {
      if (chunk.done) {
        tokenCount = chunk.tokenCount ?? 0
      } else {
        fullContent += chunk.delta
      }
      yield chunk
    }

    const assistantMsg: Message = {
      id: this.ids.generate(),
      conversationId: input.conversationId,
      role: 'assistant',
      content: fullContent,
      tokenCount,
      createdAt: new Date().toISOString(),
    }
    await this.messages.save(assistantMsg)
  }
}
