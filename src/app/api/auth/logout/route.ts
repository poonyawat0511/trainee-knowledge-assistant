import { NextResponse } from 'next/server'
import { AUTH_COOKIE } from '@/modules/auth/infrastructure/factory'

export async function POST() {
  const response = NextResponse.json({ success: true })
  response.cookies.delete(AUTH_COOKIE)
  return response
}
