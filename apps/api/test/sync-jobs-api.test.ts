import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type Database from 'better-sqlite3';
import type { authRoutes as AuthRoutes } from '../src/routes/auth.js';
import type { syncJobRoutes as SyncJobRoutes } from '../src/routes/sync-jobs.js';
import type { SyncQueue, SyncQueueMessage } from '../src/services/sync-queue.js';

const JWT_SECRET = 'test-secret-key-with-32-characters!!';

describe('sync jobs API routes', () => {
  const app = Fastify();
  let db: Database.Database;
  let authRoutes: typeof AuthRoutes;
  let syncJobRoutes: typeof SyncJobRoutes;

  class FakeSyncQueue implements SyncQueue {
    public messages: SyncQueueMessage[] = [];

    async enqueue(message: SyncQueueMessage): Promise<string> {
      this.messages.push(message);
      return `msg-${message.runId}`;
    }

    async dequeueBlocking(_timeoutSeconds: number): Promise<SyncQueueMessage | null> {
      return this.messages.shift() ?? null;
    }
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_EXPIRES_IN = '1h';
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
    process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
    process.env.APP_DOMAIN = 'app.automationglass.com';

    const sqlite = await import('../src/db/sqlite.js');
    db = sqlite.createDatabase();

    ({ authRoutes } = await import('../src/routes/auth.js'));
    ({ syncJobRoutes } = await import('../src/routes/sync-jobs.js'));

    app.decorate('sqlite', db);
    app.decorate('syncQueue', new FakeSyncQueue());
    await app.register(authRoutes);
    await app.register(syncJobRoutes);
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  async function registerAndLogin(email: string): Promise<string> {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email,
        password: 'Password123!'
      }
    });

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email,
        password: 'Password123!'
      }
    });

    return (login.json() as { accessToken: string }).accessToken;
  }

  it('returns 401 for list endpoint without token', async () => {
    const response = await app.inject({ method: 'GET', url: '/sync-jobs' });
    expect(response.statusCode).toBe(401);
  });

  it('creates, lists, updates, and deletes sync jobs scoped to user', async () => {
    const ownerToken = await registerAndLogin('sync-owner@example.com');
    const otherToken = await registerAndLogin('sync-other@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/sync-jobs',
      headers: {
        authorization: `Bearer ${ownerToken}`
      },
      payload: {
        name: 'Orders sync',
        sourceSpreadsheetId: 'sheet-001',
        sourceSheetName: 'Orders',
        destinationType: 'sqlite',
        destinationConfig: { table: 'orders' },
        fieldMapping: { order_id: 'id' },
        triggerType: 'schedule',
        triggerConfig: { timezone: 'UTC' },
        cronExpression: '*/10 * * * *',
        queueTopic: 'sync-jobs'
      }
    });

    expect(create.statusCode).toBe(201);
    const createdJob = (create.json() as { job: { id: number; userId: number } }).job;

    const ownerList = await app.inject({
      method: 'GET',
      url: '/sync-jobs',
      headers: {
        authorization: `Bearer ${ownerToken}`
      }
    });

    expect(ownerList.statusCode).toBe(200);
    expect((ownerList.json() as { jobs: Array<{ id: number }> }).jobs).toHaveLength(1);

    const otherList = await app.inject({
      method: 'GET',
      url: '/sync-jobs',
      headers: {
        authorization: `Bearer ${otherToken}`
      }
    });

    expect(otherList.statusCode).toBe(200);
    expect((otherList.json() as { jobs: Array<{ id: number }> }).jobs).toHaveLength(0);

    const patchByOther = await app.inject({
      method: 'PATCH',
      url: `/sync-jobs/${createdJob.id}`,
      headers: {
        authorization: `Bearer ${otherToken}`
      },
      payload: {
        status: 'paused'
      }
    });

    expect(patchByOther.statusCode).toBe(404);

    const patchByOwner = await app.inject({
      method: 'PATCH',
      url: `/sync-jobs/${createdJob.id}`,
      headers: {
        authorization: `Bearer ${ownerToken}`
      },
      payload: {
        status: 'paused',
        queueTopic: 'sync-jobs-priority'
      }
    });

    expect(patchByOwner.statusCode).toBe(200);
    expect((patchByOwner.json() as { job: { status: string; queueTopic: string } }).job.status).toBe('paused');

    const deleteByOther = await app.inject({
      method: 'DELETE',
      url: `/sync-jobs/${createdJob.id}`,
      headers: {
        authorization: `Bearer ${otherToken}`
      }
    });

    expect(deleteByOther.statusCode).toBe(404);

    const deleteByOwner = await app.inject({
      method: 'DELETE',
      url: `/sync-jobs/${createdJob.id}`,
      headers: {
        authorization: `Bearer ${ownerToken}`
      }
    });

    expect(deleteByOwner.statusCode).toBe(204);

    const ownerListAfterDelete = await app.inject({
      method: 'GET',
      url: '/sync-jobs',
      headers: {
        authorization: `Bearer ${ownerToken}`
      }
    });

    expect((ownerListAfterDelete.json() as { jobs: Array<{ id: number }> }).jobs).toHaveLength(0);
  });

  it('queues a manual sync run for an active job', async () => {
    const token = await registerAndLogin('sync-run@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/sync-jobs',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        name: 'Run me',
        sourceSpreadsheetId: 'sheet-run',
        destinationType: 'sqlite',
        destinationConfig: { table: 'sync_data' },
        fieldMapping: { id: 'id' }
      }
    });

    const jobId = (create.json() as { job: { id: number } }).job.id;

    const run = await app.inject({
      method: 'POST',
      url: `/sync-jobs/${jobId}/run`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(run.statusCode).toBe(202);
    expect((run.json() as { run: { status: string; queueMessageId: string | null } }).run.status).toBe('queued');
  });

  it('returns 400 for invalid request body', async () => {
    const token = await registerAndLogin('sync-invalid@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/sync-jobs',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        name: '',
        sourceSpreadsheetId: 'sheet-xyz',
        destinationType: 'sqlite',
        destinationConfig: {},
        fieldMapping: {}
      }
    });

    expect(create.statusCode).toBe(400);

    const patch = await app.inject({
      method: 'PATCH',
      url: '/sync-jobs/1',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {}
    });

    expect(patch.statusCode).toBe(400);
  });

  it('returns 400 for invalid cron validation combinations', async () => {
    const token = await registerAndLogin('sync-cron-invalid@example.com');

    const missingCronForSchedule = await app.inject({
      method: 'POST',
      url: '/sync-jobs',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        name: 'Missing cron',
        sourceSpreadsheetId: 'sheet-missing-cron',
        destinationType: 'sqlite',
        destinationConfig: { table: 'sync_data' },
        fieldMapping: { id: 'id' },
        triggerType: 'schedule'
      }
    });

    expect(missingCronForSchedule.statusCode).toBe(400);

    const invalidCronForSchedule = await app.inject({
      method: 'POST',
      url: '/sync-jobs',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        name: 'Invalid cron',
        sourceSpreadsheetId: 'sheet-invalid-cron',
        destinationType: 'sqlite',
        destinationConfig: { table: 'sync_data' },
        fieldMapping: { id: 'id' },
        triggerType: 'schedule',
        cronExpression: 'bad cron'
      }
    });

    expect(invalidCronForSchedule.statusCode).toBe(400);

    const cronForManual = await app.inject({
      method: 'POST',
      url: '/sync-jobs',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        name: 'Manual with cron',
        sourceSpreadsheetId: 'sheet-manual-cron',
        destinationType: 'sqlite',
        destinationConfig: { table: 'sync_data' },
        fieldMapping: { id: 'id' },
        triggerType: 'manual',
        cronExpression: '*/5 * * * *'
      }
    });

    expect(cronForManual.statusCode).toBe(400);
  });

  it('returns 400 when running a paused job', async () => {
    const token = await registerAndLogin('sync-run-paused@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/sync-jobs',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        name: 'Run paused job',
        sourceSpreadsheetId: 'sheet-paused-run',
        destinationType: 'sqlite',
        destinationConfig: { table: 'sync_data' },
        fieldMapping: { id: 'id' }
      }
    });

    const jobId = (create.json() as { job: { id: number } }).job.id;

    await app.inject({
      method: 'PATCH',
      url: `/sync-jobs/${jobId}`,
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        status: 'paused'
      }
    });

    const run = await app.inject({
      method: 'POST',
      url: `/sync-jobs/${jobId}/run`,
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(run.statusCode).toBe(400);
    expect(run.json()).toEqual({ error: 'Sync job is not active' });
  });
});
