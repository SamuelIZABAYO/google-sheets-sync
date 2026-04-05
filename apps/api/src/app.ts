import Fastify from 'fastify';
import { createDatabase } from './db/sqlite.js';
import { healthRoute } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { syncJobRoutes } from './routes/sync-jobs.js';
import { createSyncQueueFromEnv, type SyncQueue } from './services/sync-queue.js';
import { SyncWorkerPool, workerPoolConfigFromEnv, type SyncExecutor } from './services/sync-worker-pool.js';
import { SourceToSheetSyncExecutor } from './services/source-to-sheet-sync-executor.js';
import { SyncJobRepository } from './db/sync-job-repository.js';
import { SyncRunRepository } from './db/sync-run-repository.js';
import { schedulerConfigFromEnv, SyncScheduler } from './services/sync-scheduler.js';
import './types.js';

type BuildAppOptions = {
  syncQueue?: SyncQueue | null;
  disableWorkers?: boolean;
  syncExecutor?: SyncExecutor;
};

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: true });
  const db = createDatabase();

  const syncQueue = options.syncQueue ?? createSyncQueueFromEnv();

  app.decorate('sqlite', db);
  app.decorate('syncQueue', syncQueue);

  app.get('/', async () => ({
    ok: true,
    message: 'Google Sheets Sync API is running'
  }));

  app.register(healthRoute);
  app.register(authRoutes);
  app.register(syncJobRoutes);

  let workerPool: SyncWorkerPool | null = null;
  let scheduler: SyncScheduler | null = null;

  app.addHook('onReady', async () => {
    if (options.disableWorkers || !syncQueue) {
      return;
    }

    const syncRunRepository = new SyncRunRepository(db);
    const syncJobRepository = new SyncJobRepository(db);
    const workerConfig = workerPoolConfigFromEnv();

    workerPool = new SyncWorkerPool(
      app.log,
      syncQueue,
      syncRunRepository,
      syncJobRepository,
      options.syncExecutor ?? new SourceToSheetSyncExecutor(db, app.log),
      workerConfig.concurrency,
      workerConfig.pollTimeoutSeconds
    );

    workerPool.start();

    const schedulerConfig = schedulerConfigFromEnv();
    if (schedulerConfig.enabled) {
      scheduler = new SyncScheduler(app.log, syncJobRepository, syncRunRepository, syncQueue, schedulerConfig.intervalMs);
      scheduler.start();
    }
  });

  app.addHook('onClose', async () => {
    if (scheduler) {
      await scheduler.stop();
    }

    if (workerPool) {
      await workerPool.stop();
    }

    db.close();
  });

  return app;
}
