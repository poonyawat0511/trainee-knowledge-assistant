import bcrypt from 'bcryptjs'
import type { PasswordHasher } from '../application/ports'

export class BcryptPasswordHasher implements PasswordHasher {
  async verify(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash)
  }
}
