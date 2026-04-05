import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../config/env.js';

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function hasIndex(db: Database.Database, indexName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(indexName) as { name: string } | undefined;

  return Boolean(row);
}

export function createDatabase() {
  const dbPath = env.DATABASE_PATH;

  if (dbPath !== ':memory:') {
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      auth_provider TEXT NOT NULL DEFAULT 'local',
      google_sub TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TRIGGER IF NOT EXISTS users_updated_at_trigger
    AFTER UPDATE ON users
    FOR EACH ROW
    BEGIN
      UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END;

    CREATE TABLE IF NOT EXISTS sync_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      source_spreadsheet_id TEXT NOT NULL,
      source_sheet_name TEXT,
      destination_type TEXT NOT NULL DEFAULT 'sqlite',
      destination_config_json TEXT NOT NULL,
      field_mapping_json TEXT NOT NULL,
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      trigger_config_json TEXT,
      cron_expression TEXT,
      queue_topic TEXT NOT NULL DEFAULT 'sync-jobs',
      last_run_status TEXT,
      last_run_at TEXT,
      last_error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TRIGGER IF NOT EXISTS sync_jobs_updated_at_trigger
    AFTER UPDATE ON sync_jobs
    FOR EACH ROW
    BEGIN
      UPDATE sync_jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END;

    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      trigger_source TEXT NOT NULL,
      status TEXT NOT NULL,
      queue_message_id TEXT,
      queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      finished_at TEXT,
      records_processed INTEGER NOT NULL DEFAULT 0,
      records_succeeded INTEGER NOT NULL DEFAULT 0,
      records_failed INTEGER NOT NULL DEFAULT 0,
      result_json TEXT,
      error_message TEXT,
      error_details_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(job_id) REFERENCES sync_jobs(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TRIGGER IF NOT EXISTS sync_runs_updated_at_trigger
    AFTER UPDATE ON sync_runs
    FOR EACH ROW
    BEGIN
      UPDATE sync_runs SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END;

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS google_oauth_tokens (
      user_id INTEGER PRIMARY KEY,
      google_sub TEXT NOT NULL,
      encrypted_access_token TEXT NOT NULL,
      encrypted_refresh_token TEXT,
      scope TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TRIGGER IF NOT EXISTS google_oauth_tokens_updated_at_trigger
    AFTER UPDATE ON google_oauth_tokens
    FOR EACH ROW
    BEGIN
      UPDATE google_oauth_tokens SET updated_at = CURRENT_TIMESTAMP WHERE user_id = OLD.user_id;
    END;
  `);

  if (!hasColumn(db, 'users', 'auth_provider')) {
    db.exec("ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local';");
  }

  if (!hasColumn(db, 'users', 'google_sub')) {
    db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT UNIQUE;');
  }

  if (!hasColumn(db, 'sync_jobs', 'user_id')) {
    db.exec('ALTER TABLE sync_jobs ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;');
  }

  if (!hasColumn(db, 'sync_jobs', 'name')) {
    db.exec("ALTER TABLE sync_jobs ADD COLUMN name TEXT NOT NULL DEFAULT 'Untitled sync job';");
  }

  if (!hasColumn(db, 'sync_jobs', 'source_spreadsheet_id')) {
    db.exec("ALTER TABLE sync_jobs ADD COLUMN source_spreadsheet_id TEXT NOT NULL DEFAULT '';");
  }

  if (!hasColumn(db, 'sync_jobs', 'source_sheet_name')) {
    db.exec('ALTER TABLE sync_jobs ADD COLUMN source_sheet_name TEXT;');
  }

  if (!hasColumn(db, 'sync_jobs', 'destination_type')) {
    db.exec("ALTER TABLE sync_jobs ADD COLUMN destination_type TEXT NOT NULL DEFAULT 'sqlite';");
  }

  if (!hasColumn(db, 'sync_jobs', 'destination_config_json')) {
    db.exec("ALTER TABLE sync_jobs ADD COLUMN destination_config_json TEXT NOT NULL DEFAULT '{}';");
  }

  if (!hasColumn(db, 'sync_jobs', 'field_mapping_json')) {
    db.exec("ALTER TABLE sync_jobs ADD COLUMN field_mapping_json TEXT NOT NULL DEFAULT '{}';");
  }

  if (!hasColumn(db, 'sync_jobs', 'trigger_type')) {
    db.exec("ALTER TABLE sync_jobs ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'manual';");
  }

  if (!hasColumn(db, 'sync_jobs', 'trigger_config_json')) {
    db.exec('ALTER TABLE sync_jobs ADD COLUMN trigger_config_json TEXT;');
  }

  if (!hasColumn(db, 'sync_jobs', 'cron_expression')) {
    db.exec('ALTER TABLE sync_jobs ADD COLUMN cron_expression TEXT;');
  }

  if (!hasColumn(db, 'sync_jobs', 'queue_topic')) {
    db.exec("ALTER TABLE sync_jobs ADD COLUMN queue_topic TEXT NOT NULL DEFAULT 'sync-jobs';");
  }

  if (!hasColumn(db, 'sync_jobs', 'last_run_status')) {
    db.exec('ALTER TABLE sync_jobs ADD COLUMN last_run_status TEXT;');
  }

  if (!hasColumn(db, 'sync_jobs', 'last_run_at')) {
    db.exec('ALTER TABLE sync_jobs ADD COLUMN last_run_at TEXT;');
  }

  if (!hasColumn(db, 'sync_jobs', 'last_error_message')) {
    db.exec('ALTER TABLE sync_jobs ADD COLUMN last_error_message TEXT;');
  }

  if (!hasColumn(db, 'sync_jobs', 'updated_at')) {
    db.exec('ALTER TABLE sync_jobs ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;');
  }

  if (!hasIndex(db, 'idx_sync_jobs_user_status')) {
    db.exec('CREATE INDEX idx_sync_jobs_user_status ON sync_jobs(user_id, status);');
  }

  if (!hasIndex(db, 'idx_sync_jobs_user_updated_at')) {
    db.exec('CREATE INDEX idx_sync_jobs_user_updated_at ON sync_jobs(user_id, updated_at DESC);');
  }

  if (!hasIndex(db, 'idx_sync_runs_job_created_at')) {
    db.exec('CREATE INDEX idx_sync_runs_job_created_at ON sync_runs(job_id, created_at DESC);');
  }

  if (!hasIndex(db, 'idx_sync_runs_user_status')) {
    db.exec('CREATE INDEX idx_sync_runs_user_status ON sync_runs(user_id, status);');
  }

  return db;
}
