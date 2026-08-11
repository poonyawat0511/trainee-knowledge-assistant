import { NextResponse } from 'next/server'
import { getUserId } from '@/shared/auth/get-user-id'
import { makeConversationRepository, makeMessageRepository } from '@/modules/chat/infrastructure/factory'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request)
  if (!userId) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } }, { status: 401 })
  }

  const { id } = await params

  const conversation = await makeConversationRepository().findById(id, userId)
  if (!conversation) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } }, { status: 404 })
  }

  const messages = await makeMessageRepository().listByConversation(id)
  return NextResponse.json({
    messages: messages.map((m) => ({ role: m.role, content: m.content, tokenCount: m.tokenCount })),
  })
}
