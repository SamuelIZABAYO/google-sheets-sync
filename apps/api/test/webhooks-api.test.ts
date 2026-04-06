import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type Database from 'better-sqlite3';
import type { authRoutes as AuthRoutes } from '../src/routes/auth.js';
import type { syncJobRoutes as SyncJobRoutes } from '../src/routes/sync-jobs.js';
import type { webhookRoutes as WebhookRoutes } from '../src/routes/webhooks.js';
import type { SyncQueue, SyncQueueMessage } from '../src/services/sync-queue.js';

const JWT_SECRET = 'test-secret-key-with-32-characters!!';

describe('webhooks API routes', () => {
  const app = Fastify();
  let db: Database.Database;
  let authRoutes: typeof AuthRoutes;
  let syncJobRoutes: typeof SyncJobRoutes;
  let webhookRoutes: typeof WebhookRoutes;

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
    ({ webhookRoutes } = await import('../src/routes/webhooks.js'));

    app.decorate('sqlite', db);
    app.decorate('syncQueue', new FakeSyncQueue());
    await app.register(authRoutes);
    await app.register(syncJobRoutes);
    await app.register(webhookRoutes);
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

  it('accepts a valid webhook trigger and enqueues a webhook run', async () => {
    const token = await registerAndLogin('webhook-happy@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/sync-jobs',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        name: 'Webhook sync',
        sourceSpreadsheetId: 'sheet-webhook',
        destinationType: 'sqlite',
        destinationConfig: { table: 'sync_data' },
        fieldMapping: { id: 'id' },
        triggerType: 'webhook',
        triggerConfig: {
          secret: '0123456789abcdef0123456789abcdef',
          allowedEvents: ['external.data.updated']
        }
      }
    });

    expect(create.statusCode).toBe(201);
    const jobId = (create.json() as { job: { id: number } }).job.id;

    const trigger = await app.inject({
      method: 'POST',
      url: `/webhooks/sync-jobs/${jobId}/trigger`,
      headers: {
        'x-webhook-secret': '0123456789abcdef0123456789abcdef'
      },
      payload: {
        event: 'external.data.updated',
        payload: { source: 'crm' },
        timestamp: '2026-04-06T13:00:00.000Z'
      }
    });

    expect(trigger.statusCode).toBe(202);
    expect((trigger.json() as { run: { triggerSource: string; status: string } }).run.triggerSource).toBe('webhook');
    expect((trigger.json() as { run: { triggerSource: string; status: string } }).run.status).toBe('queued');
  });

  it('rejects webhook with invalid secret', async () => {
    const token = await registerAndLogin('webhook-secret@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/sync-jobs',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        name: 'Webhook auth',
        sourceSpreadsheetId: 'sheet-webhook-auth',
        destinationType: 'sqlite',
        destinationConfig: { table: 'sync_data' },
        fieldMapping: { id: 'id' },
        triggerType: 'webhook',
        triggerConfig: {
          secret: 'abcdef0123456789abcdef0123456789'
        }
      }
    });

    const jobId = (create.json() as { job: { id: number } }).job.id;

    const trigger = await app.inject({
      method: 'POST',
      url: `/webhooks/sync-jobs/${jobId}/trigger`,
      headers: {
        'x-webhook-secret': 'wrong-secret'
      },
      payload: {
        event: 'external.data.updated'
      }
    });

    expect(trigger.statusCode).toBe(401);
    expect(trigger.json()).toEqual({ error: 'Invalid webhook secret' });
  });

  it('rejects webhook payload and invalid webhook trigger config', async () => {
    const token = await registerAndLogin('webhook-invalid-payload@example.com');

    const invalidCreate = await app.inject({
      method: 'POST',
      url: '/sync-jobs',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        name: 'Webhook invalid config',
        sourceSpreadsheetId: 'sheet-webhook-invalid',
        destinationType: 'sqlite',
        destinationConfig: { table: 'sync_data' },
        fieldMapping: { id: 'id' },
        triggerType: 'webhook',
        triggerConfig: {
          secret: 'short'
        }
      }
    });

    expect(invalidCreate.statusCode).toBe(400);

    const validCreate = await app.inject({
      method: 'POST',
      url: '/sync-jobs',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        name: 'Webhook valid config',
        sourceSpreadsheetId: 'sheet-webhook-valid',
        destinationType: 'sqlite',
        destinationConfig: { table: 'sync_data' },
        fieldMapping: { id: 'id' },
        triggerType: 'webhook',
        triggerConfig: {
          secret: 'fedcba9876543210fedcba9876543210',
          allowedEvents: ['external.data.updated']
        }
      }
    });

    const jobId = (validCreate.json() as { job: { id: number } }).job.id;

    const invalidPayload = await app.inject({
      method: 'POST',
      url: `/webhooks/sync-jobs/${jobId}/trigger`,
      headers: {
        'x-webhook-secret': 'fedcba9876543210fedcba9876543210'
      },
      payload: {
        payload: { any: 'value' }
      }
    });

    expect(invalidPayload.statusCode).toBe(400);

    const disallowedEvent = await app.inject({
      method: 'POST',
      url: `/webhooks/sync-jobs/${jobId}/trigger`,
      headers: {
        'x-webhook-secret': 'fedcba9876543210fedcba9876543210'
      },
      payload: {
        event: 'external.data.deleted'
      }
    });

    expect(disallowedEvent.statusCode).toBe(400);
    expect(disallowedEvent.json()).toEqual({ error: 'Webhook event not allowed' });
  });
});
