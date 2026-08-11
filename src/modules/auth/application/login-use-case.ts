import { ok, err, type Result } from '@/shared/kernel/result'
import type { UserRepository, PasswordHasher, TokenService } from './ports'

export class LoginUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService
  ) {}

  async execute(
    username: string,
    password: string
  ): Promise<Result<{ token: string }, 'INVALID_CREDENTIALS'>> {
    const user = await this.users.findByUsername(username)
    if (!user) return err('INVALID_CREDENTIALS')

    const valid = await this.hasher.verify(password, user.passwordHash)
    if (!valid) return err('INVALID_CREDENTIALS')

    const token = await this.tokens.sign({ userId: user.id })
    return ok({ token })
  }
}
