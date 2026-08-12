import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { makeUploadDocumentUseCase, makeDocumentRepository } from '@/modules/documents/infrastructure/factory'
import { makeConversationRepository } from '@/modules/chat/infrastructure/factory'
import { getUserId } from '@/shared/auth/get-user-id'

export async function POST(request: Request) {
  const userId = await getUserId(request)
  if (!userId) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: { code: 'INVALID_BODY', message: 'file is required' } }, { status: 400 })
  }

  let conversationId = formData.get('conversationId')
  if (typeof conversationId !== 'string' || conversationId.length === 0) {
    const conversation = { id: randomUUID(), userId, title: 'New chat', createdAt: new Date().toISOString() }
    await makeConversationRepository().save(conversation)
    conversationId = conversation.id
  } else {
    // A client-supplied conversationId must belong to the caller, same as every other
    // conversation-scoped route. Without this an authenticated user could attach documents
    // into someone else's conversation.
    const conversation = await makeConversationRepository().findById(conversationId, userId)
    if (!conversation) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } }, { status: 404 })
    }
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const result = await makeUploadDocumentUseCase().execute({
    userId,
    conversationId,
    filename: file.name,
    mimeType: file.type,
    buffer,
  })

  if (!result.ok) {
    return NextResponse.json({ error: { code: result.error, message: uploadErrorMessage(result.error) } }, { status: 400 })
  }

  return NextResponse.json({
    documentId: result.value.id,
    filename: result.value.filename,
    charCount: result.value.contentText.length,
    conversationId,
  })
}

export async function GET(request: Request) {
  const userId = await getUserId(request)
  if (!userId) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } }, { status: 401 })
  }

  const conversationId = new URL(request.url).searchParams.get('conversationId')
  const docs = conversationId
    ? await makeDocumentRepository().listByConversation(conversationId, userId)
    : await makeDocumentRepository().listByUser(userId)

  return NextResponse.json({
    documents: docs.map((d) => ({ id: d.id, filename: d.filename, createdAt: d.createdAt })),
  })
}

function uploadErrorMessage(code: 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'EMPTY_FILE'): string {
  switch (code) {
    case 'UNSUPPORTED_TYPE':
      return 'Only PDF and TXT files are supported'
    case 'TOO_LARGE':
      return 'File exceeds the 10MB limit'
    case 'EMPTY_FILE':
      return 'No readable text was found in the file'
  }
}
