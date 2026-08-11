import { makeVerifySessionUseCase, AUTH_COOKIE } from '@/modules/auth/infrastructure/factory'

export async function getUserId(request: Request): Promise<string | null> {
  const cookieHeader = request.headers.get('cookie') ?? ''
  const match = cookieHeader.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`))
  const token = match?.[1]
  const session = await makeVerifySessionUseCase().execute(token)
  return session?.userId ?? null
}
