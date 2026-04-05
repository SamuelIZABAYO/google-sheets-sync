import { describe, expect, it } from 'vitest';

describe('sync worker pool', () => {
  it('claims queued runs and marks them succeeded', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
    process.env.JWT_SECRET = 'test-secret-key-with-32-characters!!';
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
    process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
    process.env.APP_DOMAIN = 'app.automationglass.com';

    const { createDatabase } = await import('../src/db/sqlite.js');
    const { SyncJobRepository } = await import('../src/db/sync-job-repository.js');
    const { SyncRunRepository } = await import('../src/db/sync-run-repository.js');
    const { SyncWorkerPool } = await import('../src/services/sync-worker-pool.js');

    const db = createDatabase();
    const syncJobRepository = new SyncJobRepository(db);
    const syncRunRepository = new SyncRunRepository(db);

    const userResult = db
      .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
      .run('worker@example.com', 'hash');
    const userId = Number(userResult.lastInsertRowid);

    const job = syncJobRepository.create({
      userId,
      name: 'Worker Job',
      sourceSpreadsheetId: 'sheet1',
      destinationType: 'sqlite',
      destinationConfigJson: JSON.stringify({ table: 'records' }),
      fieldMappingJson: JSON.stringify({ id: 'id' })
    });

    const run = syncRunRepository.create({
      jobId: job.id,
      userId,
      triggerSource: 'manual',
      status: 'queued'
    });

    const queue = {
      async enqueue() {
        return 'queued';
      },
      async dequeueBlocking(_timeoutSeconds: number) {
        if ((queue as { done?: boolean }).done) {
          return null;
        }

        (queue as { done?: boolean }).done = true;

        return {
          runId: run.id,
          jobId: job.id,
          userId,
          triggerSource: 'manual' as const,
          queuedAt: run.queuedAt
        };
      }
    };

    const executor = {
      async execute() {
        return {
          recordsProcessed: 10,
          recordsSucceeded: 10,
          recordsFailed: 0,
          resultJson: JSON.stringify({ ok: true })
        };
      }
    };

    const logger = {
      info: () => undefined,
      error: () => undefined,
      warn: () => undefined
    };

    const pool = new SyncWorkerPool(logger as never, queue, syncRunRepository, syncJobRepository, executor, 1, 1);
    pool.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await pool.stop();

    const updatedRun = syncRunRepository.findByIdForUser(run.id, userId);
    expect(updatedRun?.status).toBe('succeeded');
    expect(updatedRun?.recordsProcessed).toBe(10);

    const updatedJob = syncJobRepository.findByIdForUser(job.id, userId);
    expect(updatedJob?.lastRunStatus).toBe('succeeded');

    db.close();
  });
});
