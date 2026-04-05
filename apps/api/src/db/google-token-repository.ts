import type Database from 'better-sqlite3';

export type GoogleTokenRecord = {
  userId: number;
  googleSub: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  scope: string;
  expiresAt: string;
  updatedAt: string;
};

type GoogleTokenRow = {
  user_id: number;
  google_sub: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  scope: string;
  expires_at: string;
  updated_at: string;
};

function mapRow(row: GoogleTokenRow): GoogleTokenRecord {
  return {
    userId: row.user_id,
    googleSub: row.google_sub,
    encryptedAccessToken: row.encrypted_access_token,
    encryptedRefreshToken: row.encrypted_refresh_token,
    scope: row.scope,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at
  };
}

export class GoogleTokenRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(input: Omit<GoogleTokenRecord, 'updatedAt'>): void {
    this.db
      .prepare(
        `INSERT INTO google_oauth_tokens
          (user_id, google_sub, encrypted_access_token, encrypted_refresh_token, scope, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id)
         DO UPDATE SET
          google_sub = excluded.google_sub,
          encrypted_access_token = excluded.encrypted_access_token,
          encrypted_refresh_token = COALESCE(excluded.encrypted_refresh_token, google_oauth_tokens.encrypted_refresh_token),
          scope = excluded.scope,
          expires_at = excluded.expires_at,
          updated_at = CURRENT_TIMESTAMP`
      )
      .run(
        input.userId,
        input.googleSub,
        input.encryptedAccessToken,
        input.encryptedRefreshToken,
        input.scope,
        input.expiresAt
      );
  }

  findByUserId(userId: number): GoogleTokenRecord | null {
    const row = this.db
      .prepare(
        'SELECT user_id, google_sub, encrypted_access_token, encrypted_refresh_token, scope, expires_at, updated_at FROM google_oauth_tokens WHERE user_id = ?'
      )
      .get(userId) as GoogleTokenRow | undefined;

    return row ? mapRow(row) : null;
  }
}
