import type Database from 'better-sqlite3';

export class OauthStateRepository {
  constructor(private readonly db: Database.Database) {}

  save(state: string, expiresAt: string): void {
    this.db.prepare('INSERT OR REPLACE INTO oauth_states (state, expires_at) VALUES (?, ?)').run(state, expiresAt);
  }

  consume(state: string): boolean {
    const row = this.db.prepare('SELECT state, expires_at FROM oauth_states WHERE state = ?').get(state) as
      | { state: string; expires_at: string }
      | undefined;

    if (!row) {
      return false;
    }

    this.db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);

    const expiresAt = Date.parse(row.expires_at);
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
  }
}
