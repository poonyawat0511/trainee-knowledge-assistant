import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { makeVerifySessionUseCase, AUTH_COOKIE } from '@/modules/auth/infrastructure/factory'

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE)?.value
  const session = await makeVerifySessionUseCase().execute(token)

  if (!session) {
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
        { status: 401 }
      )
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/chat/:path*',
    '/upload/:path*',
    '/api/documents/:path*',
    '/api/chat/:path*',
  ],
}
