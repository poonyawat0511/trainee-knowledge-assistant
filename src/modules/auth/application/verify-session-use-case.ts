import type { TokenService } from './ports'

export class VerifySessionUseCase {
  constructor(private readonly tokens: TokenService) {}

  async execute(token: string | undefined): Promise<{ userId: string } | null> {
    if (!token) return null
    return this.tokens.verify(token)
  }
}
