import { z } from "zod"
import { randomUUID } from "node:crypto"
import { getUserId } from "@/shared/auth/get-user-id"
import { chatRateLimiter } from "@/shared/rate-limit/token-bucket"
import { makeConversationRepository, makeMessageRepository } from "@/modules/chat/infrastructure/factory"
import { OpenRouterProvider } from "@/modules/chat/infrastructure/openrouter-provider"
import { SqliteDocumentTextLookup } from "@/modules/chat/infrastructure/document-text-lookup"
import { BuildContextUseCase } from "@/modules/chat/application/build-context-use-case"

const bodySchema = z.object({
  conversationId: z.string().min(1),
  message: z.string().min(1).max(8000),
  documentId: z.string().min(1).optional(),
})

export async function POST(request: Request) {
  const userId = await getUserId(request)
  if (!userId) {
    return new Response("Unauthorized", { status: 401 })
  }

  const limit = chatRateLimiter.tryConsume(userId)
  if (!limit.allowed) {
    return new Response("Too many requests", { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } })
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return new Response("Invalid request", { status: 400 })
  }

  const { conversationId, message, documentId } = parsed.data

  const conversation = await makeConversationRepository().findById(conversationId, userId)
  if (!conversation) {
    return new Response("Conversation not found", { status: 404 })
  }

  const messages = makeMessageRepository()
  const history = await messages.listByConversation(conversationId)
  const context = new BuildContextUseCase(new SqliteDocumentTextLookup())
  const systemPrompt = await context.execute({ userId, documentId })

  await messages.save({
    id: randomUUID(),
    conversationId,
    role: "user",
    content: message,
    tokenCount: 0,
    createdAt: new Date().toISOString(),
  })

  const provider = new OpenRouterProvider()

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      let fullContent = ""
      let tokenCount = 0

      try {
        for await (const chunk of provider.completeStream({
          systemPrompt: systemPrompt ?? undefined,
          messages: [
            ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
            { role: "user", content: message },
          ],
        })) {
          if (chunk.done) {
            tokenCount = chunk.tokenCount ?? 0
          } else {
            fullContent += chunk.delta
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: chunk.delta })}

`))
          }
        }

        await messages.save({
          id: randomUUID(),
          conversationId,
          role: "assistant",
          content: fullContent,
          tokenCount,
          createdAt: new Date().toISOString(),
        })

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, tokenCount })}

`))
      } catch {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "AI_PROVIDER_ERROR" })}

`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}