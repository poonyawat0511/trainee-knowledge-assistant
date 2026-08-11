import { LoginUseCase } from '../application/login-use-case'
import { VerifySessionUseCase } from '../application/verify-session-use-case'
import { SqliteUserRepository } from './sqlite-user-repository'
import { BcryptPasswordHasher } from './bcrypt-password-hasher'
import { JwtTokenService } from './jwt-token-service'

const tokenService = new JwtTokenService()

export function makeLoginUseCase(): LoginUseCase {
  return new LoginUseCase(
    new SqliteUserRepository(),
    new BcryptPasswordHasher(),
    tokenService
  )
}

export function makeVerifySessionUseCase(): VerifySessionUseCase {
  return new VerifySessionUseCase(tokenService)
}

export const AUTH_COOKIE = 'session'
