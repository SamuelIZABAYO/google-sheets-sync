import type Database from 'better-sqlite3';
import type { User } from '../models/user.js';

type UserRow = {
  id: number;
  email: string;
  password_hash: string | null;
  auth_provider: 'local' | 'google';
  google_sub: string | null;
  created_at: string;
  updated_at: string;
};

function mapUserRow(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    authProvider: row.auth_provider,
    googleSub: row.google_sub,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class UserRepository {
  constructor(private readonly db: Database.Database) {}

  findByEmail(email: string): User | null {
    const row = this.db
      .prepare(
        'SELECT id, email, password_hash, auth_provider, google_sub, created_at, updated_at FROM users WHERE email = ?'
      )
      .get(email) as UserRow | undefined;

    return row ? mapUserRow(row) : null;
  }

  findByGoogleSub(googleSub: string): User | null {
    const row = this.db
      .prepare(
        'SELECT id, email, password_hash, auth_provider, google_sub, created_at, updated_at FROM users WHERE google_sub = ?'
      )
      .get(googleSub) as UserRow | undefined;

    return row ? mapUserRow(row) : null;
  }

  findById(id: number): User | null {
    const row = this.db
      .prepare(
        'SELECT id, email, password_hash, auth_provider, google_sub, created_at, updated_at FROM users WHERE id = ?'
      )
      .get(id) as UserRow | undefined;

    return row ? mapUserRow(row) : null;
  }

  createLocal(email: string, passwordHash: string): User {
    const result = this.db
      .prepare('INSERT INTO users (email, password_hash, auth_provider) VALUES (?, ?, ?)')
      .run(email, passwordHash, 'local');

    const user = this.findById(Number(result.lastInsertRowid));

    if (!user) {
      throw new Error('Failed to create user');
    }

    return user;
  }

  createGoogle(email: string, googleSub: string): User {
    const result = this.db
      .prepare('INSERT INTO users (email, password_hash, auth_provider, google_sub) VALUES (?, NULL, ?, ?)')
      .run(email, 'google', googleSub);

    const user = this.findById(Number(result.lastInsertRowid));

    if (!user) {
      throw new Error('Failed to create user');
    }

    return user;
  }

  linkGoogleAccount(userId: number, googleSub: string): User {
    this.db.prepare('UPDATE users SET google_sub = ?, auth_provider = ? WHERE id = ?').run(googleSub, 'google', userId);
    const user = this.findById(userId);

    if (!user) {
      throw new Error('Failed to update user');
    }

    return user;
  }
}
