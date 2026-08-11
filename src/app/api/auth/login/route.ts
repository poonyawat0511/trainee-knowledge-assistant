import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeLoginUseCase, AUTH_COOKIE } from '@/modules/auth/infrastructure/factory'
import { seedAdmin } from '@/modules/auth/infrastructure/seed-admin'

const bodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

export async function POST(request: Request) {
  await seedAdmin()

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_BODY', message: 'username and password are required' } },
      { status: 400 }
    )
  }

  const result = await makeLoginUseCase().execute(
    parsed.data.username,
    parsed.data.password
  )

  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.error, message: 'Invalid username or password' } },
      { status: 401 }
    )
  }

  const response = NextResponse.json({ success: true })
  response.cookies.set(AUTH_COOKIE, result.value.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24,
  })
  return response
}
