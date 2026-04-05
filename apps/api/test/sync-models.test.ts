import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { SyncJobRepository } from '../src/db/sync-job-repository.js';
import { SyncRunRepository } from '../src/db/sync-run-repository.js';

const JWT_SECRET = 'test-secret-key-with-32-characters!!';

describe('sync job + run schema and repositories', () => {
  let db: Database.Database;
  let userId = 0;
  let otherUserId = 0;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_EXPIRES_IN = '1h';
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
    process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
    process.env.APP_DOMAIN = 'app.automationglass.com';

    const { createDatabase } = await import('../src/db/sqlite.js');
    db = createDatabase();

    db.prepare('INSERT INTO users (email, password_hash, auth_provider) VALUES (?, ?, ?)').run(
      'owner@example.com',
      'hash',
      'local'
    );
    db.prepare('INSERT INTO users (email, password_hash, auth_provider) VALUES (?, ?, ?)').run(
      'other@example.com',
      'hash',
      'local'
    );

    userId = (db.prepare('SELECT id FROM users WHERE email = ?').get('owner@example.com') as { id: number }).id;
    otherUserId = (db.prepare('SELECT id FROM users WHERE email = ?').get('other@example.com') as { id: number }).id;
  });

  afterAll(() => {
    db.close();
  });

  it('creates expected sync tables and key columns', () => {
    const jobColumns = db.prepare('PRAGMA table_info(sync_jobs)').all() as Array<{ name: string }>;
    const runColumns = db.prepare('PRAGMA table_info(sync_runs)').all() as Array<{ name: string }>;

    const jobColumnNames = new Set(jobColumns.map((column) => column.name));
    const runColumnNames = new Set(runColumns.map((column) => column.name));

    expect(jobColumnNames.has('user_id')).toBe(true);
    expect(jobColumnNames.has('trigger_type')).toBe(true);
    expect(jobColumnNames.has('destination_config_json')).toBe(true);
    expect(jobColumnNames.has('queue_topic')).toBe(true);

    expect(runColumnNames.has('job_id')).toBe(true);
    expect(runColumnNames.has('trigger_source')).toBe(true);
    expect(runColumnNames.has('status')).toBe(true);
    expect(runColumnNames.has('result_json')).toBe(true);
  });

  it('stores and queries sync jobs scoped to user', () => {
    const jobs = new SyncJobRepository(db);

    const created = jobs.create({
      userId,
      name: 'Orders sync',
      sourceSpreadsheetId: 'sheet-id-1',
      sourceSheetName: 'Orders',
      destinationType: 'webhook',
      destinationConfigJson: JSON.stringify({ url: 'https://example.com/hook' }),
      fieldMappingJson: JSON.stringify({ order_id: 'id' }),
      triggerType: 'schedule',
      triggerConfigJson: JSON.stringify({ timezone: 'UTC' }),
      cronExpression: '*/5 * * * *',
      queueTopic: 'sync-jobs'
    });

    expect(created.userId).toBe(userId);
    expect(created.triggerType).toBe('schedule');

    const visibleToOwner = jobs.findByIdForUser(created.id, userId);
    const invisibleToOther = jobs.findByIdForUser(created.id, otherUserId);

    expect(visibleToOwner?.id).toBe(created.id);
    expect(invisibleToOther).toBeNull();
  });

  it('stores run history and blocks cross-user access', () => {
    const jobs = new SyncJobRepository(db);
    const runs = new SyncRunRepository(db);

    const job = jobs.create({
      userId,
      name: 'Inventory sync',
      sourceSpreadsheetId: 'sheet-id-2',
      sourceSheetName: 'Inventory',
      destinationType: 'sqlite',
      destinationConfigJson: JSON.stringify({ table: 'inventory' }),
      fieldMappingJson: JSON.stringify({ sku: 'sku' })
    });

    const run = runs.create({
      jobId: job.id,
      userId,
      triggerSource: 'manual',
      status: 'queued',
      queueMessageId: 'upstash-msg-1'
    });

    const started = runs.markRunning(run.id, userId, new Date().toISOString());
    const completed = runs.complete({
      id: run.id,
      userId,
      status: 'succeeded',
      finishedAt: new Date().toISOString(),
      recordsProcessed: 100,
      recordsSucceeded: 100,
      recordsFailed: 0,
      resultJson: JSON.stringify({ durationMs: 3200 })
    });

    jobs.updateLastRun({
      id: job.id,
      userId,
      lastRunStatus: 'succeeded',
      lastRunAt: new Date().toISOString(),
      lastErrorMessage: null
    });

    const runForOwner = runs.findByIdForUser(run.id, userId);
    const runForOther = runs.findByIdForUser(run.id, otherUserId);

    expect(started).toBe(true);
    expect(completed).toBe(true);
    expect(runForOwner?.status).toBe('succeeded');
    expect(runForOwner?.recordsProcessed).toBe(100);
    expect(runForOther).toBeNull();
  });
});
