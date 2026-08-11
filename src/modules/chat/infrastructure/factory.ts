import { randomUUID } from 'node:crypto'
import { SendMessageUseCase } from '../application/send-message-use-case'
import { StreamMessageUseCase } from '../application/stream-message-use-case'
import { BuildContextUseCase } from '../application/build-context-use-case'
import { SqliteMessageRepository } from './sqlite-message-repository'
import { SqliteConversationRepository } from './sqlite-conversation-repository'
import { OpenRouterProvider } from './openrouter-provider'
import { SqliteDocumentTextLookup } from './document-text-lookup'

export function makeSendMessageUseCase(): SendMessageUseCase {
  const context = new BuildContextUseCase(new SqliteDocumentTextLookup())
  return new SendMessageUseCase(
    new SqliteMessageRepository(),
    new OpenRouterProvider(),
    { generate: () => randomUUID() },
    context
  )
}

export function makeStreamMessageUseCase(): StreamMessageUseCase {
  const context = new BuildContextUseCase(new SqliteDocumentTextLookup())
  return new StreamMessageUseCase(
    new SqliteMessageRepository(),
    new OpenRouterProvider(),
    { generate: () => randomUUID() },
    context
  )
}

export function makeConversationRepository(): SqliteConversationRepository {
  return new SqliteConversationRepository()
}

export function makeMessageRepository(): SqliteMessageRepository {
  return new SqliteMessageRepository()
}
