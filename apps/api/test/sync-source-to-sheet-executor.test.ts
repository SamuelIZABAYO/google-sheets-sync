import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';

const cleanupPaths: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  for (const p of cleanupPaths.splice(0, cleanupPaths.length)) {
    if (fs.existsSync(p)) {
      fs.rmSync(p, { force: true });
    }
  }
});

describe('source to sheet sync executor', () => {
  type SetupOptions = {
    expiresAtOffsetMs?: number;
    refreshToken?: string | null;
    sourceSpreadsheetId?: string;
    destinationConfig?: Record<string, unknown>;
  };

  async function setupFixture(options?: SetupOptions) {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-with-32-characters!!';
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
    process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
    process.env.APP_DOMAIN = 'app.automationglass.com';

    const dbPath = path.join(os.tmpdir(), `gssync-task7-${Date.now()}-${Math.random()}.db`);
    cleanupPaths.push(dbPath);
    process.env.DATABASE_PATH = dbPath;

    const { createDatabase } = await import('../src/db/sqlite.js');
    const { encryptToken } = await import('../src/services/token-crypto.js');
    const { SourceToSheetSyncExecutor } = await import('../src/services/source-to-sheet-sync-executor.js');

    const db = createDatabase();

    const userResult = db
      .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
      .run(`executor-${Date.now()}-${Math.random()}@example.com`, 'hash');
    const userId = Number(userResult.lastInsertRowid);

    db.prepare(
      `INSERT INTO google_oauth_tokens
        (user_id, google_sub, encrypted_access_token, encrypted_refresh_token, scope, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      'google-sub-1',
      encryptToken('access-token-123'),
      options?.refreshToken === undefined
        ? encryptToken('refresh-token-abc')
        : options.refreshToken
          ? encryptToken(options.refreshToken)
          : null,
      'https://www.googleapis.com/auth/spreadsheets',
      new Date(Date.now() + (options?.expiresAtOffsetMs ?? 300_000)).toISOString()
    );

    db.exec(`
      CREATE TABLE IF NOT EXISTS source_records (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        amount INTEGER NOT NULL
      );
      DELETE FROM source_records;
      INSERT INTO source_records (name, amount) VALUES ('Alice', 10), ('Bob', 20);
    `);

    const destinationConfig =
      options?.destinationConfig ??
      {
        spreadsheetId: 'spreadsheet-123',
        sheetName: 'SyncData',
        writeMode: 'replace',
        source: {
          type: 'sqlite',
          table: 'source_records'
        }
      };

    const jobResult = db
      .prepare(
        `INSERT INTO sync_jobs
          (user_id, name, source_spreadsheet_id, source_sheet_name, destination_type, destination_config_json, field_mapping_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        'SQLite to Google Sheet',
        options?.sourceSpreadsheetId ?? 'source_records',
        null,
        'google_sheets',
        JSON.stringify(destinationConfig),
        JSON.stringify({ id: 'ID', name: 'Name', amount: 'Amount' })
      );

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

    return { db, userId, jobId: Number(jobResult.lastInsertRowid), executor };
  }

  it('reads sqlite source rows and writes them to Google Sheets', async () => {
    const { db, userId, jobId, executor } = await setupFixture();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          access_token: 'fallback-access-token',
          scope: 'https://www.googleapis.com/auth/spreadsheets',
          token_type: 'Bearer',
          expires_in: 3600
        })
      } as unknown as Response;
    });

    vi.stubGlobal('fetch', fetchMock);

    const result = await executor.execute({ jobId, userId, runId: 1 });
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

  it('refreshes Google access token when expired before sync', async () => {
    const { db, userId, jobId, executor } = await setupFixture({ expiresAtOffsetMs: -60_000, refreshToken: 'refresh-token-abc' });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'fresh-access-token',
          scope: 'https://www.googleapis.com/auth/spreadsheets',
          token_type: 'Bearer',
          expires_in: 3600
        })
      } as unknown as Response)
      .mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => ''
      } as unknown as Response);

    vi.stubGlobal('fetch', fetchMock);

    await executor.execute({ jobId, userId, runId: 1 });

    expect(fetchMock).toHaveBeenCalled();
    const tokenRequest = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(String(tokenRequest[0])).toContain('oauth2.googleapis.com/token');

    const clearRequest = fetchMock.mock.calls[1] as [string, RequestInit | undefined];
    expect(String(clearRequest[1]?.headers && (clearRequest[1].headers as Record<string, string>).authorization)).toContain(
      'fresh-access-token'
    );

    db.close();
  });

  it('retries once with refreshed token when Google Sheets responds 401', async () => {
    const { db, userId, jobId, executor } = await setupFixture();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'unauthorized' } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'retry-access-token',
          scope: 'https://www.googleapis.com/auth/spreadsheets',
          token_type: 'Bearer',
          expires_in: 3600
        })
      } as unknown as Response)
      .mockResolvedValue({ ok: true, status: 200, text: async () => '' } as unknown as Response);

    vi.stubGlobal('fetch', fetchMock);

    await executor.execute({ jobId, userId, runId: 1 });

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4);
    const tokenRequest = fetchMock.mock.calls.find((call) => String(call[0]).includes('oauth2.googleapis.com/token'));
    expect(tokenRequest).toBeDefined();

    db.close();
  });

  it('reads postgres source rows and writes them to Google Sheets', async () => {
    const queryMock = vi.fn().mockResolvedValue({
      rows: [
        { id: 11, name: 'Alice', amount: 10 },
        { id: 12, name: 'Bob', amount: 20 }
      ]
    });
    const endMock = vi.fn().mockResolvedValue(undefined);
    const poolFactoryMock = vi.fn().mockImplementation(() => ({
      query: queryMock,
      end: endMock
    }));

    vi.doMock('pg', () => ({
      Pool: poolFactoryMock
    }));

    const { db, userId, jobId, executor } = await setupFixture({
      sourceSpreadsheetId: 'public.source_records',
      destinationConfig: {
        spreadsheetId: 'spreadsheet-123',
        sheetName: 'SyncData',
        writeMode: 'replace',
        source: {
          type: 'postgres',
          connectionString: 'postgresql://sync_user:secret@db.internal:5432/sync',
          query: 'SELECT id, name, amount FROM source_records WHERE amount >= $1',
          params: [10],
          ssl: { enabled: true, rejectUnauthorized: true }
        }
      }
    });

    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        text: async () => ''
      } as unknown as Response;
    });

    vi.stubGlobal('fetch', fetchMock);

    await executor.execute({ jobId, userId, runId: 1 });

    expect(poolFactoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: 'postgresql://sync_user:secret@db.internal:5432/sync',
        ssl: { rejectUnauthorized: true },
        max: 1
      })
    );
    expect(queryMock).toHaveBeenCalledWith('SELECT id, name, amount FROM source_records WHERE amount >= $1', [10]);
    expect(endMock).toHaveBeenCalledTimes(1);

    const writeInit = (fetchMock.mock.calls as unknown[][])[1]?.[1] as RequestInit | undefined;
    expect(writeInit).toBeDefined();
    const writeBody = JSON.parse(String(writeInit?.body));
    expect(writeBody.values).toEqual([
      ['ID', 'Name', 'Amount'],
      [11, 'Alice', 10],
      [12, 'Bob', 20]
    ]);

    db.close();
  });

  it('rejects non-select postgres queries', async () => {
    vi.doMock('pg', () => ({
      Pool: vi.fn()
    }));

    const { db, userId, jobId, executor } = await setupFixture({
      destinationConfig: {
        spreadsheetId: 'spreadsheet-123',
        sheetName: 'SyncData',
        writeMode: 'replace',
        source: {
          type: 'postgres',
          connectionString: 'postgresql://sync_user:secret@db.internal:5432/sync',
          query: 'DELETE FROM source_records'
        }
      }
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => ''
      }))
    );

    await expect(executor.execute({ jobId, userId, runId: 1 })).rejects.toThrow('source.query must be a read-only SELECT statement');

    db.close();
  });

  it('reads REST source rows and writes them to Google Sheets with env-token auth', async () => {
    process.env.REST_API_SOURCE_TOKEN = 'rest-api-secret-token';

    const { db, userId, jobId, executor } = await setupFixture({
      destinationConfig: {
        spreadsheetId: 'spreadsheet-123',
        sheetName: 'SyncData',
        writeMode: 'replace',
        source: {
          type: 'rest',
          url: 'https://api.example.com/orders',
          method: 'GET',
          queryParams: { status: 'active', limit: 2 },
          responsePath: 'data.items',
          authTokenEnvVar: 'REST_API_SOURCE_TOKEN'
        }
      }
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            items: [
              { id: 101, name: 'Alice', amount: 15 },
              { id: 102, name: 'Bob', amount: 25 }
            ]
          }
        })
      } as unknown as Response)
      .mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => ''
      } as unknown as Response);

    vi.stubGlobal('fetch', fetchMock);

    await executor.execute({ jobId, userId, runId: 1 });

    const restRequest = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(restRequest[0]).toContain('https://api.example.com/orders');
    expect(restRequest[0]).toContain('status=active');
    expect(restRequest[0]).toContain('limit=2');
    expect(String((restRequest[1]?.headers as Record<string, string>)?.authorization)).toBe('Bearer rest-api-secret-token');

    const writeInit = (fetchMock.mock.calls as unknown[][])[2]?.[1] as RequestInit | undefined;
    const writeBody = JSON.parse(String(writeInit?.body));
    expect(writeBody.values).toEqual([
      ['ID', 'Name', 'Amount'],
      [101, 'Alice', 15],
      [102, 'Bob', 25]
    ]);

    db.close();
  });

  it('rejects REST source when auth token env var is missing', async () => {
    delete process.env.REST_API_SOURCE_TOKEN;

    const { db, userId, jobId, executor } = await setupFixture({
      destinationConfig: {
        spreadsheetId: 'spreadsheet-123',
        sheetName: 'SyncData',
        writeMode: 'replace',
        source: {
          type: 'rest',
          url: 'https://api.example.com/orders',
          authTokenEnvVar: 'REST_API_SOURCE_TOKEN'
        }
      }
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => ''
      }))
    );

    await expect(executor.execute({ jobId, userId, runId: 1 })).rejects.toThrow(
      'Missing REST source auth token in env var: REST_API_SOURCE_TOKEN'
    );

    db.close();
  });

  it('reads CSV file source rows and writes them to Google Sheets', async () => {
    const csvPath = path.join(os.tmpdir(), `gssync-source-${Date.now()}-${Math.random()}.csv`);
    cleanupPaths.push(csvPath);
    fs.writeFileSync(csvPath, 'id,name,amount\n201,Alice,15\n202,Bob,25\n', 'utf8');

    const { db, userId, jobId, executor } = await setupFixture({
      destinationConfig: {
        spreadsheetId: 'spreadsheet-123',
        sheetName: 'SyncData',
        writeMode: 'replace',
        source: {
          type: 'csv',
          filePath: csvPath
        }
      }
    });

    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        text: async () => ''
      } as unknown as Response;
    });

    vi.stubGlobal('fetch', fetchMock);

    await executor.execute({ jobId, userId, runId: 1 });

    const writeInit = (fetchMock.mock.calls as unknown[][])[1]?.[1] as RequestInit | undefined;
    const writeBody = JSON.parse(String(writeInit?.body));
    expect(writeBody.values).toEqual([
      ['ID', 'Name', 'Amount'],
      ['201', 'Alice', '15'],
      ['202', 'Bob', '25']
    ]);

    db.close();
  });

  it('reads Excel file source rows and writes them to Google Sheets', async () => {
    const xlsxPath = path.join(os.tmpdir(), `gssync-source-${Date.now()}-${Math.random()}.xlsx`);
    cleanupPaths.push(xlsxPath);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Orders');
    worksheet.addRow(['id', 'name', 'amount']);
    worksheet.addRow([301, 'Alice', 35]);
    worksheet.addRow([302, 'Bob', 45]);
    await workbook.xlsx.writeFile(xlsxPath);

    const { db, userId, jobId, executor } = await setupFixture({
      destinationConfig: {
        spreadsheetId: 'spreadsheet-123',
        sheetName: 'SyncData',
        writeMode: 'replace',
        source: {
          type: 'excel',
          filePath: xlsxPath,
          worksheetName: 'Orders'
        }
      }
    });

    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        text: async () => ''
      } as unknown as Response;
    });

    vi.stubGlobal('fetch', fetchMock);

    await executor.execute({ jobId, userId, runId: 1 });

    const writeInit = (fetchMock.mock.calls as unknown[][])[1]?.[1] as RequestInit | undefined;
    const writeBody = JSON.parse(String(writeInit?.body));
    expect(writeBody.values).toEqual([
      ['ID', 'Name', 'Amount'],
      [301, 'Alice', 35],
      [302, 'Bob', 45]
    ]);

    db.close();
  });

  it('rejects file source when file path does not exist', async () => {
    const missingFilePath = path.join(os.tmpdir(), `does-not-exist-${Date.now()}.csv`);

    const { db, userId, jobId, executor } = await setupFixture({
      destinationConfig: {
        spreadsheetId: 'spreadsheet-123',
        sheetName: 'SyncData',
        writeMode: 'replace',
        source: {
          type: 'csv',
          filePath: missingFilePath
        }
      }
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => ''
      }))
    );

    await expect(executor.execute({ jobId, userId, runId: 1 })).rejects.toThrow(`CSV source file not found at path: ${missingFilePath}`);

    db.close();
  });
});
