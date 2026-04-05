import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const cleanupPaths: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const p of cleanupPaths.splice(0, cleanupPaths.length)) {
    if (fs.existsSync(p)) {
      fs.rmSync(p, { force: true });
    }
  }
});

describe('source to sheet sync executor', () => {
  it('reads sqlite source rows and writes them to Google Sheets', async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-with-32-characters!!';
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
    process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
    process.env.APP_DOMAIN = 'app.automationglass.com';

    const dbPath = path.join(os.tmpdir(), `gssync-task7-${Date.now()}.db`);
    cleanupPaths.push(dbPath);
    process.env.DATABASE_PATH = dbPath;

    const { createDatabase } = await import('../src/db/sqlite.js');
    const { encryptToken } = await import('../src/services/token-crypto.js');
    const { SourceToSheetSyncExecutor } = await import('../src/services/source-to-sheet-sync-executor.js');

    const db = createDatabase();

    const userResult = db
      .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
      .run('executor@example.com', 'hash');
    const userId = Number(userResult.lastInsertRowid);

    db.prepare(
      `INSERT INTO google_oauth_tokens
        (user_id, google_sub, encrypted_access_token, encrypted_refresh_token, scope, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      'google-sub-1',
      encryptToken('access-token-123'),
      null,
      'https://www.googleapis.com/auth/spreadsheets',
      new Date(Date.now() + 60_000).toISOString()
    );

    db.exec(`
      CREATE TABLE source_records (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        amount INTEGER NOT NULL
      );
      INSERT INTO source_records (name, amount) VALUES ('Alice', 10), ('Bob', 20);
    `);

    db.prepare(
      `INSERT INTO sync_jobs
        (user_id, name, source_spreadsheet_id, source_sheet_name, destination_type, destination_config_json, field_mapping_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      'SQLite to Google Sheet',
      'source_records',
      null,
      'google_sheets',
      JSON.stringify({
        spreadsheetId: 'spreadsheet-123',
        sheetName: 'SyncData',
        writeMode: 'replace',
        source: {
          type: 'sqlite',
          table: 'source_records'
        }
      }),
      JSON.stringify({ id: 'ID', name: 'Name', amount: 'Amount' })
    );

    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      return {
        ok: true,
        status: 200,
        text: async () => ''
      } as unknown as Response;
    });

    vi.stubGlobal('fetch', fetchMock);

    const logger = {
      info: () => undefined,
      error: () => undefined,
      warn: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
      fatal: () => undefined,
      child: () => logger
    };

    const executor = new SourceToSheetSyncExecutor(db, logger as never);
    const result = await executor.execute({ jobId: 1, userId, runId: 1 });

    expect(result.recordsProcessed).toBe(2);
    expect(result.recordsSucceeded).toBe(2);
    expect(result.recordsFailed).toBe(0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const writeRequest = fetchMock.mock.calls[1] as [string, RequestInit | undefined] | undefined;
    expect(String(writeRequest?.[0])).toContain('/values/');

    const writeBody = JSON.parse(String(writeRequest?.[1]?.body));
    expect(writeBody.values).toEqual([
      ['ID', 'Name', 'Amount'],
      [1, 'Alice', 10],
      [2, 'Bob', 20]
    ]);

    db.close();
  });
});
