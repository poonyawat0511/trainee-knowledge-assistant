export type MessageRole = 'user' | 'assistant' | 'system'

export interface Message {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  tokenCount: number
  createdAt: string
}

export interface Conversation {
  id: string
  userId: string
  title: string
  createdAt: string
}
