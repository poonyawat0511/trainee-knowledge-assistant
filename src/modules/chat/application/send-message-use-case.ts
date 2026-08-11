import { ok, err, type Result } from '@/shared/kernel/result'
import type { Message } from '../domain/message'
import type { MessageRepository, AiProvider, IdGenerator } from './ports'
import type { BuildContextUseCase } from './build-context-use-case'

export class SendMessageUseCase {
  constructor(
    private readonly messages: MessageRepository,
    private readonly ai: AiProvider,
    private readonly ids: IdGenerator,
    private readonly buildContext: BuildContextUseCase
  ) {}

  async execute(input: {
    userId: string
    conversationId: string
    userMessage: string
    documentId?: string
  }): Promise<Result<{ reply: string; tokenCount: number }, 'AI_PROVIDER_ERROR'>> {
    const history = await this.messages.listByConversation(input.conversationId)
    const systemPrompt = await this.buildContext.execute({
      userId: input.userId,
      documentId: input.documentId,
    })

    const userMsg: Message = {
      id: this.ids.generate(),
      conversationId: input.conversationId,
      role: 'user',
      content: input.userMessage,
      tokenCount: 0,
      createdAt: new Date().toISOString(),
    }
    await this.messages.save(userMsg)

    let completion: { content: string; tokenCount: number }
    try {
      completion = await this.ai.complete({
        systemPrompt: systemPrompt ?? undefined,
        messages: [
          ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          { role: 'user', content: input.userMessage },
        ],
      })
    } catch {
      return err('AI_PROVIDER_ERROR')
    }

    const assistantMsg: Message = {
      id: this.ids.generate(),
      conversationId: input.conversationId,
      role: 'assistant',
      content: completion.content,
      tokenCount: completion.tokenCount,
      createdAt: new Date().toISOString(),
    }
    await this.messages.save(assistantMsg)

    return ok({ reply: completion.content, tokenCount: completion.tokenCount })
  }
}
