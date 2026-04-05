import { describe, expect, it } from 'vitest';

describe('sync run service', () => {
  it('rejects enqueue when queue is unavailable', async () => {
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
    const { QueueUnavailableError, SyncRunService } = await import('../src/services/sync-run-service.js');

    const db = createDatabase();
    const syncJobRepository = new SyncJobRepository(db);
    const syncRunRepository = new SyncRunRepository(db);

    const userResult = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run('run-service@example.com', 'hash');
    const userId = Number(userResult.lastInsertRowid);

    const job = syncJobRepository.create({
      userId,
      name: 'Queue unavailable job',
      sourceSpreadsheetId: 'sheet-queue-unavailable',
      destinationType: 'sqlite',
      destinationConfigJson: JSON.stringify({ table: 'records' }),
      fieldMappingJson: JSON.stringify({ id: 'id' })
    });

    const service = new SyncRunService(syncJobRepository, syncRunRepository, null);

    await expect(service.enqueueRun(job.id, userId, 'manual')).rejects.toBeInstanceOf(QueueUnavailableError);

    const runs = syncRunRepository.listByJobForUser(job.id, userId, 5);
    expect(runs).toHaveLength(0);

    db.close();
  });

  it('rejects enqueue for non-active jobs', async () => {
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
    const { SyncJobInactiveError, SyncRunService } = await import('../src/services/sync-run-service.js');

    const db = createDatabase();
    const syncJobRepository = new SyncJobRepository(db);
    const syncRunRepository = new SyncRunRepository(db);

    const userResult = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run('run-service-paused@example.com', 'hash');
    const userId = Number(userResult.lastInsertRowid);

    const job = syncJobRepository.create({
      userId,
      name: 'Paused job',
      sourceSpreadsheetId: 'sheet-paused',
      destinationType: 'sqlite',
      destinationConfigJson: JSON.stringify({ table: 'records' }),
      fieldMappingJson: JSON.stringify({ id: 'id' })
    });

    syncJobRepository.update({
      id: job.id,
      userId,
      status: 'paused'
    });

    const queue = {
      async enqueue() {
        return 'msg';
      },
      async dequeueBlocking() {
        return null;
      }
    };

    const service = new SyncRunService(syncJobRepository, syncRunRepository, queue);

    await expect(service.enqueueRun(job.id, userId, 'manual')).rejects.toBeInstanceOf(SyncJobInactiveError);

    db.close();
  });
});
