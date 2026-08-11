import type { Message, Conversation } from '../domain/message'

export interface MessageRepository {
  save(message: Message): Promise<void>
  listByConversation(conversationId: string): Promise<Message[]>
}

export interface ConversationRepository {
  save(conversation: Conversation): Promise<void>
  findById(id: string, userId: string): Promise<Conversation | null>
  listByUser(userId: string): Promise<Conversation[]>
}

export interface StreamChunk {
  delta: string
  done: boolean
  tokenCount?: number
}

export interface AiProvider {
  complete(input: {
    systemPrompt?: string
    messages: { role: 'user' | 'assistant'; content: string }[]
  }): Promise<{ content: string; tokenCount: number }>

  completeStream(input: {
    systemPrompt?: string
    messages: { role: 'user' | 'assistant'; content: string }[]
  }): AsyncIterable<StreamChunk>
}

export interface DocumentTextLookup {
  getContentText(documentId: string, userId: string): Promise<string | null>
}

export interface IdGenerator {
  generate(): string
}
