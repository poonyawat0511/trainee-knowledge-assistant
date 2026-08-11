import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserId } from '@/shared/auth/get-user-id'
import { makeSendMessageUseCase } from '@/modules/chat/infrastructure/factory'

const bodySchema = z.object({
  conversationId: z.string().min(1),
  message: z.string().min(1).max(8000),
  documentId: z.string().min(1).optional(),
})

export async function POST(request: Request) {
  const userId = await getUserId(request)
  if (!userId) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } }, { status: 401 })
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'INVALID_BODY', message: 'Invalid chat request' } }, { status: 400 })
  }

  const result = await makeSendMessageUseCase().execute({
    userId,
    conversationId: parsed.data.conversationId,
    userMessage: parsed.data.message,
    documentId: parsed.data.documentId,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.error, message: 'The AI provider failed to respond. Please try again.' } },
      { status: 502 }
    )
  }

  return NextResponse.json({ reply: result.value.reply, tokenCount: result.value.tokenCount })
}
