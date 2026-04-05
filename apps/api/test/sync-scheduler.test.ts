import { describe, expect, it } from 'vitest';

function setRequiredEnv() {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = ':memory:';
  process.env.JWT_SECRET = 'test-secret-key-with-32-characters!!';
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
  process.env.APP_DOMAIN = 'app.automationglass.com';
}

describe('sync scheduler', () => {
  it('evaluates cron expressions in UTC', async () => {
    setRequiredEnv();
    const { isCronExpressionDue, isCronExpressionValid } = await import('../src/services/sync-scheduler.js');

    const now = new Date('2026-04-05T20:10:00.000Z'); // Sunday

    expect(isCronExpressionValid('*/5 * * * *')).toBe(true);
    expect(isCronExpressionDue('*/5 * * * *', now)).toBe(true);
    expect(isCronExpressionDue('11 * * * *', now)).toBe(false);
    expect(isCronExpressionDue('10 20 * * 0', now)).toBe(true);
    expect(isCronExpressionDue('10 20 * * 7', now)).toBe(true);
    expect(isCronExpressionValid('bad expression')).toBe(false);
  });

  it('enqueues due scheduled jobs once per minute', async () => {
    setRequiredEnv();

    const { createDatabase } = await import('../src/db/sqlite.js');
    const { SyncJobRepository } = await import('../src/db/sync-job-repository.js');
    const { SyncRunRepository } = await import('../src/db/sync-run-repository.js');
    const { SyncScheduler } = await import('../src/services/sync-scheduler.js');

    const db = createDatabase();
    const syncJobRepository = new SyncJobRepository(db);
    const syncRunRepository = new SyncRunRepository(db);

    const userResult = db
      .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
      .run('scheduler@example.com', 'hash');
    const userId = Number(userResult.lastInsertRowid);

    const job = syncJobRepository.create({
      userId,
      name: 'Scheduled Job',
      sourceSpreadsheetId: 'sheet-1',
      destinationType: 'sqlite',
      destinationConfigJson: JSON.stringify({ table: 'records' }),
      fieldMappingJson: JSON.stringify({ id: 'id' }),
      triggerType: 'schedule',
      cronExpression: '*/5 * * * *'
    });

    const queueMessages: Array<{ runId: number; jobId: number; userId: number }> = [];

    const queue = {
      async enqueue(message: { runId: number; jobId: number; userId: number }) {
        queueMessages.push(message);
        return `msg-${message.runId}`;
      },
      async dequeueBlocking() {
        return null;
      }
    };

    const logger = {
      info: () => undefined,
      error: () => undefined,
      warn: () => undefined
    };

    const scheduler = new SyncScheduler(logger as never, syncJobRepository, syncRunRepository, queue, 30_000);

    await scheduler.tick(new Date('2026-04-05T20:10:20.000Z'));
    await scheduler.tick(new Date('2026-04-05T20:10:50.000Z'));
    await scheduler.tick(new Date('2026-04-05T20:11:10.000Z'));

    expect(queueMessages).toHaveLength(1);
    expect(queueMessages[0]?.jobId).toBe(job.id);

    const runs = syncRunRepository.listByJobForUser(job.id, userId, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.triggerSource).toBe('schedule');
    expect(runs[0]?.queueMessageId).toBe(`msg-${runs[0]?.id}`);

    db.close();
  });
});
