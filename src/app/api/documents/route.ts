import { NextResponse } from 'next/server'
import { makeUploadDocumentUseCase, makeDocumentRepository } from '@/modules/documents/infrastructure/factory'
import { makeVerifySessionUseCase, AUTH_COOKIE } from '@/modules/auth/infrastructure/factory'

async function getUserId(request: Request): Promise<string | null> {
  const cookieHeader = request.headers.get('cookie') ?? ''
  const match = cookieHeader.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`))
  const token = match?.[1]
  const session = await makeVerifySessionUseCase().execute(token)
  return session?.userId ?? null
}

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

  const buffer = Buffer.from(await file.arrayBuffer())
  const result = await makeUploadDocumentUseCase().execute({
    userId,
    filename: file.name,
    mimeType: file.type,
    buffer,
  })

  if (!result.ok) {
    return NextResponse.json({ error: { code: result.error, message: uploadErrorMessage(result.error) } }, { status: 400 })
  }

  return NextResponse.json({
    id: result.value.id,
    filename: result.value.filename,
    charCount: result.value.contentText.length,
  })
}

export async function GET(request: Request) {
  const userId = await getUserId(request)
  if (!userId) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } }, { status: 401 })
  }

  const docs = await makeDocumentRepository().listByUser(userId)
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
