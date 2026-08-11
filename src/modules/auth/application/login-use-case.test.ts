import { describe, it, expect, vi } from 'vitest'
import { LoginUseCase } from './login-use-case'
import type { UserRepository, PasswordHasher, TokenService } from './ports'
import type { User } from '../domain/user'

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    username: 'admin',
    passwordHash: 'hashed',
    createdAt: '2026-01-01',
    ...overrides,
  }
}

describe('LoginUseCase', () => {
  it('returns a token on valid credentials', async () => {
    const users: UserRepository = { findByUsername: vi.fn(async () => makeUser()) }
    const hasher: PasswordHasher = { verify: vi.fn(async () => true) }
    const tokens: TokenService = {
      sign: vi.fn(async () => 'signed-token'),
      verify: vi.fn(async () => null),
    }
    const useCase = new LoginUseCase(users, hasher, tokens)

    const result = await useCase.execute('admin', 'admin123')

    expect(result).toEqual({ ok: true, value: { token: 'signed-token' } })
    expect(tokens.sign).toHaveBeenCalledWith({ userId: 'u1' })
  })

  it('fails when the user does not exist', async () => {
    const users: UserRepository = { findByUsername: vi.fn(async () => null) }
    const hasher: PasswordHasher = { verify: vi.fn(async () => true) }
    const tokens: TokenService = { sign: vi.fn(), verify: vi.fn() }
    const useCase = new LoginUseCase(users, hasher, tokens)

    const result = await useCase.execute('nobody', 'x')

    expect(result).toEqual({ ok: false, error: 'INVALID_CREDENTIALS' })
    expect(tokens.sign).not.toHaveBeenCalled()
  })

  it('fails when the password does not match', async () => {
    const users: UserRepository = { findByUsername: vi.fn(async () => makeUser()) }
    const hasher: PasswordHasher = { verify: vi.fn(async () => false) }
    const tokens: TokenService = { sign: vi.fn(), verify: vi.fn() }
    const useCase = new LoginUseCase(users, hasher, tokens)

    const result = await useCase.execute('admin', 'wrong')

    expect(result).toEqual({ ok: false, error: 'INVALID_CREDENTIALS' })
  })
})
