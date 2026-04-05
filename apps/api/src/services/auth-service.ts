import bcrypt from 'bcrypt';
import { UserRepository } from '../db/user-repository.js';
import { signAccessToken } from '../auth/jwt.js';
import type { PublicUser } from '../models/user.js';
import { toPublicUser } from '../models/user.js';

const BCRYPT_ROUNDS = 12;

export class EmailAlreadyInUseError extends Error {}
export class InvalidCredentialsError extends Error {}

export class AuthService {
  constructor(private readonly userRepository: UserRepository) {}

  async register(email: string, password: string): Promise<{ user: PublicUser; accessToken: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = this.userRepository.findByEmail(normalizedEmail);

    if (existing) {
      throw new EmailAlreadyInUseError('Email already in use');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = this.userRepository.createLocal(normalizedEmail, passwordHash);

    const accessToken = signAccessToken({
      sub: String(user.id),
      email: user.email
    });

    return {
      user: toPublicUser(user),
      accessToken
    };
  }

  async login(email: string, password: string): Promise<{ user: PublicUser; accessToken: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = this.userRepository.findByEmail(normalizedEmail);

    if (!user || !user.passwordHash || user.authProvider !== 'local') {
      throw new InvalidCredentialsError('Invalid credentials');
    }

    const matches = await bcrypt.compare(password, user.passwordHash);

    if (!matches) {
      throw new InvalidCredentialsError('Invalid credentials');
    }

    const accessToken = signAccessToken({
      sub: String(user.id),
      email: user.email
    });

    return {
      user: toPublicUser(user),
      accessToken
    };
  }
}
