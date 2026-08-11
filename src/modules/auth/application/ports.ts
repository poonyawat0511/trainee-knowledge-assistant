import type { User } from '../domain/user'

export interface UserRepository {
  findByUsername(username: string): Promise<User | null>
}

export interface PasswordHasher {
  verify(password: string, hash: string): Promise<boolean>
}

export interface TokenService {
  sign(payload: { userId: string }): Promise<string>
  verify(token: string): Promise<{ userId: string } | null>
}
