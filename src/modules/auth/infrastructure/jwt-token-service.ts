import { SignJWT, jwtVerify } from 'jose'
import type { TokenService } from '../application/ports'

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not set')
  return new TextEncoder().encode(secret)
}

export class JwtTokenService implements TokenService {
  async sign(payload: { userId: string }): Promise<string> {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(getSecret())
  }

  async verify(token: string): Promise<{ userId: string } | null> {
    try {
      const { payload } = await jwtVerify(token, getSecret())
      if (typeof payload.userId !== 'string') return null
      return { userId: payload.userId }
    } catch {
      return null
    }
  }
}
