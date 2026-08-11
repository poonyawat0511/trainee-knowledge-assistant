import { describe, it, expect, vi } from 'vitest'
import { VerifySessionUseCase } from './verify-session-use-case'
import type { TokenService } from './ports'

describe('VerifySessionUseCase', () => {
  it('returns null when no token is given', async () => {
    const tokens: TokenService = { sign: vi.fn(), verify: vi.fn() }
    const useCase = new VerifySessionUseCase(tokens)
    expect(await useCase.execute(undefined)).toBeNull()
    expect(tokens.verify).not.toHaveBeenCalled()
  })

  it('delegates to TokenService.verify when a token is given', async () => {
    const tokens: TokenService = {
      sign: vi.fn(),
      verify: vi.fn(async () => ({ userId: 'u1' })),
    }
    const useCase = new VerifySessionUseCase(tokens)
    expect(await useCase.execute('abc')).toEqual({ userId: 'u1' })
  })
})
