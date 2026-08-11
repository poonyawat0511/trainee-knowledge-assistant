import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getUserId } from '@/shared/auth/get-user-id'
import { makeConversationRepository } from '@/modules/chat/infrastructure/factory'

export async function GET(request: Request) {
  const userId = await getUserId(request)
  if (!userId) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } }, { status: 401 })
  }
  const conversations = await makeConversationRepository().listByUser(userId)
  return NextResponse.json({ conversations })
}

const bodySchema = z.object({ title: z.string().min(1).max(200).optional() })

export async function POST(request: Request) {
  const userId = await getUserId(request)
  if (!userId) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } }, { status: 401 })
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
  const title = parsed.success && parsed.data.title ? parsed.data.title : 'New chat'

  const conversation = { id: randomUUID(), userId, title, createdAt: new Date().toISOString() }
  await makeConversationRepository().save(conversation)
  return NextResponse.json({ conversation })
}
