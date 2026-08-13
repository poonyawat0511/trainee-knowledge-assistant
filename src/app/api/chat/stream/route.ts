import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserId } from '@/shared/auth/get-user-id'
import { chatRateLimiter } from '@/shared/rate-limit/token-bucket'
import { makeConversationRepository, makeStreamMessageUseCase } from '@/modules/chat/infrastructure/factory'

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

  const limit = chatRateLimiter.tryConsume(userId)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down' } },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    )
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'INVALID_BODY', message: 'Invalid chat request' } }, { status: 400 })
  }

  const { conversationId, message, documentId } = parsed.data

  const conversation = await makeConversationRepository().findById(conversationId, userId)
  if (!conversation) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } }, { status: 404 })
  }

  const streamMessage = makeStreamMessageUseCase()

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      try {
        for await (const chunk of streamMessage.execute({ userId, conversationId, userMessage: message, documentId })) {
          if (chunk.done) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, tokenCount: chunk.tokenCount })}\n\n`))
          } else {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: chunk.delta })}\n\n`))
          }
        }
      } catch (cause) {
        console.error('POST /api/chat/stream: AI provider call failed', cause)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'AI_PROVIDER_ERROR' })}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
