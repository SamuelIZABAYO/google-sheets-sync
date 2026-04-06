import Database from 'better-sqlite3';
import type { FastifyBaseLogger } from 'fastify';
import { GoogleTokenRepository, type GoogleTokenRecord } from '../db/google-token-repository.js';
import { SyncJobRepository } from '../db/sync-job-repository.js';
import { GoogleOAuthService } from './google-oauth-service.js';
import { decryptToken, encryptToken } from './token-crypto.js';
import type { SyncExecutor, SyncExecutorResult } from './sync-worker-pool.js';

type DestinationConfig = {
  spreadsheetId: string;
  sheetName: string;
  writeMode?: 'replace' | 'append';
  includeHeaders?: boolean;
  source?: {
    type?: 'sqlite' | 'postgres' | 'rest';
    databasePath?: string;
    connectionString?: string;
    ssl?: {
      enabled?: boolean;
      rejectUnauthorized?: boolean;
    };
    table?: string;
    query?: string;
    params?: unknown[];
    url?: string;
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    queryParams?: Record<string, string | number | boolean>;
    body?: unknown;
    responsePath?: string;
    timeoutMs?: number;
    authTokenEnvVar?: string;
    authHeaderName?: string;
    allowInsecureHttp?: boolean;
  };
};

type JsonRow = Record<string, unknown>;

function toA1Column(index: number): string {
  let n = index;
  let col = '';
  while (n >= 0) {
    col = String.fromCharCode((n % 26) + 65) + col;
    n = Math.floor(n / 26) - 1;
  }
  return col;
}

function normalizeCell(value: unknown): string | number | boolean {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return JSON.stringify(value);
}

function isSelectQuery(query: string): boolean {
  return /^\s*select\b/i.test(query) && !/;\s*(insert|update|delete|drop|alter|create)\b/i.test(query);
}

function quoteSqliteIdentifier(input: string): string {
  return `"${input.replaceAll('"', '""')}"`;
}

function quotePostgresIdentifier(input: string): string {
  return `"${input.replaceAll('"', '""')}"`;
}

export class SourceToSheetSyncExecutor implements SyncExecutor {
  private readonly syncJobRepository: SyncJobRepository;
  private readonly googleTokenRepository: GoogleTokenRepository;
  private readonly googleOAuthService: GoogleOAuthService;

  constructor(
    private readonly appDb: Database.Database,
    private readonly logger: FastifyBaseLogger
  ) {
    this.syncJobRepository = new SyncJobRepository(appDb);
    this.googleTokenRepository = new GoogleTokenRepository(appDb);
    this.googleOAuthService = new GoogleOAuthService();
  }

  async execute(input: { jobId: number; userId: number; runId: number }): Promise<SyncExecutorResult> {
    const job = this.syncJobRepository.findByIdForUser(input.jobId, input.userId);
    if (!job) {
      throw new Error('Sync job not found');
    }

    const tokenRecord = this.googleTokenRepository.findByUserId(input.userId);
    if (!tokenRecord) {
      throw new Error('Google account is not connected for this user');
    }

    const destinationConfig = this.parseDestinationConfig(job.destinationConfigJson);
    const fieldMapping = this.parseFieldMapping(job.fieldMappingJson);

    const sourceRows = await this.readRowsFromConfiguredSource(job.sourceSpreadsheetId, destinationConfig);

    const mappedRows = sourceRows.map((row) => this.mapRow(row, fieldMapping));
    const headerRow = Object.values(fieldMapping);

    const values: Array<Array<string | number | boolean>> = [];

    if (destinationConfig.includeHeaders !== false) {
      values.push(headerRow);
    }

    values.push(...mappedRows);

    let accessToken = await this.getValidAccessToken(input.userId, tokenRecord);

    const sheetName = destinationConfig.sheetName;
    const width = Math.max(headerRow.length, 1);
    const range = `'${sheetName.replaceAll("'", "''")}'!A1:${toA1Column(width - 1)}`;

    try {
      if (destinationConfig.writeMode !== 'append') {
        await this.clearRange(destinationConfig.spreadsheetId, `'${sheetName.replaceAll("'", "''")}'`, accessToken);
      }

      if (values.length > 0) {
        await this.writeValues(destinationConfig.spreadsheetId, range, values, accessToken);
      }
    } catch (error) {
      if (!this.shouldRetryAfterUnauthorized(error) || !tokenRecord.encryptedRefreshToken) {
        throw error;
      }

      accessToken = await this.refreshAndPersistAccessToken(input.userId, tokenRecord);

      if (destinationConfig.writeMode !== 'append') {
        await this.clearRange(destinationConfig.spreadsheetId, `'${sheetName.replaceAll("'", "''")}'`, accessToken);
      }

      if (values.length > 0) {
        await this.writeValues(destinationConfig.spreadsheetId, range, values, accessToken);
      }
    }

    return {
      recordsProcessed: sourceRows.length,
      recordsSucceeded: sourceRows.length,
      recordsFailed: 0,
      resultJson: JSON.stringify({
        runId: input.runId,
        spreadsheetId: destinationConfig.spreadsheetId,
        sheetName: destinationConfig.sheetName,
        mode: destinationConfig.writeMode ?? 'replace',
        rowCount: sourceRows.length
      })
    };
  }

  private parseDestinationConfig(raw: string): DestinationConfig {
    const parsed = JSON.parse(raw) as DestinationConfig;

    if (!parsed.spreadsheetId || !parsed.sheetName) {
      throw new Error('destinationConfig must include spreadsheetId and sheetName');
    }

    if (parsed.source?.type && parsed.source.type !== 'sqlite' && parsed.source.type !== 'postgres' && parsed.source.type !== 'rest') {
      throw new Error('source.type must be one of "sqlite", "postgres", or "rest"');
    }

    if (parsed.source?.type === 'postgres' && !parsed.source.connectionString) {
      throw new Error('source.connectionString is required for source.type="postgres"');
    }

    if (parsed.source?.type === 'rest' && !parsed.source.url) {
      throw new Error('source.url is required for source.type="rest"');
    }

    return parsed;
  }

  private parseFieldMapping(raw: string): Record<string, string> {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entries = Object.entries(parsed).filter(([, value]) => typeof value === 'string' && value.length > 0);

    if (entries.length === 0) {
      throw new Error('fieldMapping must contain at least one source-to-sheet mapping');
    }

    return Object.fromEntries(entries) as Record<string, string>;
  }

  private readSourceRows(defaultTable: string, destinationConfig: DestinationConfig): JsonRow[] {
    if (destinationConfig.source?.type === 'postgres' || destinationConfig.source?.type === 'rest') {
      throw new Error('readSourceRows is only valid for sqlite sources');
    }

    const source = destinationConfig.source;
    const dbPath = source?.databasePath ?? this.appDb.name;
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });

    try {
      const query = source?.query?.trim();

      if (query) {
        if (!isSelectQuery(query)) {
          throw new Error('source.query must be a read-only SELECT statement');
        }

        const params = Array.isArray(source?.params) ? source.params : [];
        return db.prepare(query).all(...params) as JsonRow[];
      }

      const table = (source?.table ?? defaultTable ?? '').trim();
      if (!table) {
        throw new Error('Source table is required (source.table or sourceSpreadsheetId)');
      }

      return db.prepare(`SELECT * FROM ${quoteSqliteIdentifier(table)}`).all() as JsonRow[];
    } finally {
      db.close();
    }
  }

  private async readRowsFromConfiguredSource(defaultTable: string, destinationConfig: DestinationConfig): Promise<JsonRow[]> {
    if (destinationConfig.source?.type === 'postgres') {
      return this.readPostgresSourceRows(defaultTable, destinationConfig);
    }

    if (destinationConfig.source?.type === 'rest') {
      return this.readRestSourceRows(destinationConfig);
    }

    return this.readSourceRows(defaultTable, destinationConfig);
  }

  private async readPostgresSourceRows(defaultTable: string, destinationConfig: DestinationConfig): Promise<JsonRow[]> {
    const source = destinationConfig.source;
    if (!source?.connectionString) {
      throw new Error('source.connectionString is required for source.type="postgres"');
    }

    const query = source.query?.trim();
    const table = (source.table ?? defaultTable ?? '').trim();

    let sql: string;
    if (query) {
      if (!isSelectQuery(query)) {
        throw new Error('source.query must be a read-only SELECT statement');
      }
      sql = query;
    } else {
      if (!table) {
        throw new Error('Source table is required (source.table or sourceSpreadsheetId)');
      }
      sql = `SELECT * FROM ${quotePostgresIdentifier(table)}`;
    }

    const params = Array.isArray(source.params) ? source.params : [];
    const sslEnabled = source.ssl?.enabled !== false;
    const rejectUnauthorized = source.ssl?.rejectUnauthorized !== false;

    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: source.connectionString,
      ssl: sslEnabled
        ? {
            rejectUnauthorized
          }
        : false,
      max: 1,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 10_000
    });

    try {
      const result = await pool.query(sql, params);
      return result.rows as JsonRow[];
    } finally {
      await pool.end();
    }
  }

  private async readRestSourceRows(destinationConfig: DestinationConfig): Promise<JsonRow[]> {
    const source = destinationConfig.source;
    if (!source?.url) {
      throw new Error('source.url is required for source.type="rest"');
    }

    const url = new URL(source.url);
    if (!source.allowInsecureHttp && url.protocol !== 'https:') {
      throw new Error('REST source URL must use HTTPS unless source.allowInsecureHttp=true');
    }

    if (source.queryParams) {
      for (const [key, value] of Object.entries(source.queryParams)) {
        url.searchParams.set(key, String(value));
      }
    }

    const method = source.method ?? 'GET';
    if (method !== 'GET' && method !== 'POST') {
      throw new Error('source.method must be GET or POST');
    }

    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(source.headers ?? {})
    };

    if (method === 'POST' && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
      headers['content-type'] = 'application/json';
    }

    if (source.authTokenEnvVar) {
      const token = process.env[source.authTokenEnvVar];
      if (!token) {
        throw new Error(`Missing REST source auth token in env var: ${source.authTokenEnvVar}`);
      }

      const authHeaderName = (source.authHeaderName ?? 'authorization').toLowerCase();
      headers[authHeaderName] = authHeaderName === 'authorization' ? `Bearer ${token}` : token;
    }

    const timeoutMs = Math.min(Math.max(source.timeoutMs ?? 15000, 1000), 60000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify(source.body ?? {}) : undefined,
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        this.logger.error({ status: response.status, body }, 'rest source fetch failed');
        throw new Error(`REST source request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as unknown;
      const rows = this.extractRowsFromRestPayload(payload, source.responsePath);

      return rows;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`REST source request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractRowsFromRestPayload(payload: unknown, responsePath?: string): JsonRow[] {
    let selected: unknown = payload;

    if (responsePath && responsePath.trim().length > 0) {
      const pathParts = responsePath
        .split('.')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);

      for (const part of pathParts) {
        if (!selected || typeof selected !== 'object' || !(part in selected)) {
          throw new Error(`source.responsePath "${responsePath}" did not resolve to a value`);
        }
        selected = (selected as Record<string, unknown>)[part];
      }
    }

    if (!Array.isArray(selected)) {
      throw new Error('REST source response must resolve to an array of objects');
    }

    const invalidItem = selected.find((item) => item === null || typeof item !== 'object' || Array.isArray(item));
    if (invalidItem !== undefined) {
      throw new Error('REST source rows must be JSON objects');
    }

    return selected as JsonRow[];
  }

  private mapRow(row: JsonRow, fieldMapping: Record<string, string>): Array<string | number | boolean> {
    return Object.keys(fieldMapping).map((sourceField) => normalizeCell(row[sourceField]));
  }

  private async getValidAccessToken(userId: number, tokenRecord: GoogleTokenRecord): Promise<string> {
    const accessToken = decryptToken(tokenRecord.encryptedAccessToken);
    const expiresAtMs = new Date(tokenRecord.expiresAt).getTime();
    const refreshThresholdMs = Date.now() + 60_000;

    if (Number.isNaN(expiresAtMs) || expiresAtMs > refreshThresholdMs) {
      return accessToken;
    }

    if (!tokenRecord.encryptedRefreshToken) {
      this.logger.warn({ userId }, 'google access token expired and no refresh token is available');
      return accessToken;
    }

    return this.refreshAndPersistAccessToken(userId, tokenRecord);
  }

  private async refreshAndPersistAccessToken(userId: number, tokenRecord: GoogleTokenRecord): Promise<string> {
    const refreshToken = tokenRecord.encryptedRefreshToken ? decryptToken(tokenRecord.encryptedRefreshToken) : null;
    if (!refreshToken) {
      throw new Error('Google OAuth refresh token is missing');
    }

    const refreshed = await this.googleOAuthService.refreshAccessToken(refreshToken);

    const expiresAt = new Date(Date.now() + Math.max(0, refreshed.expires_in) * 1000).toISOString();
    this.googleTokenRepository.upsert({
      userId,
      googleSub: tokenRecord.googleSub,
      encryptedAccessToken: encryptToken(refreshed.access_token),
      encryptedRefreshToken: refreshed.refresh_token ? encryptToken(refreshed.refresh_token) : null,
      scope: refreshed.scope || tokenRecord.scope,
      expiresAt
    });

    this.logger.info({ userId, expiresAt }, 'google access token refreshed');

    return refreshed.access_token;
  }

  private shouldRetryAfterUnauthorized(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return error.message.includes('status 401');
  }

  private async clearRange(spreadsheetId: string, range: string, accessToken: string): Promise<void> {
    const encodedRange = encodeURIComponent(range);
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodedRange}:clear`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({})
      }
    );

    if (!response.ok) {
      const body = await response.text();
      this.logger.error({ status: response.status, body }, 'google sheets clear failed');
      throw new Error(`Google Sheets clear failed with status ${response.status}`);
    }
  }

  private async writeValues(
    spreadsheetId: string,
    range: string,
    values: Array<Array<string | number | boolean>>,
    accessToken: string
  ): Promise<void> {
    const encodedRange = encodeURIComponent(range);
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodedRange}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          majorDimension: 'ROWS',
          values
        })
      }
    );

    if (!response.ok) {
      const body = await response.text();
      this.logger.error({ status: response.status, body }, 'google sheets write failed');
      throw new Error(`Google Sheets write failed with status ${response.status}`);
    }
  }
}
