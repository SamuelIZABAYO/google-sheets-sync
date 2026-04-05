import type { FastifyBaseLogger } from 'fastify';
import { env } from '../config/env.js';
import type { SyncJobRepository } from '../db/sync-job-repository.js';
import type { SyncRunRepository } from '../db/sync-run-repository.js';
import type { SyncQueue } from './sync-queue.js';

export type SyncExecutorResult = {
  recordsProcessed: number;
  recordsSucceeded: number;
  recordsFailed: number;
  resultJson?: string | null;
};

export interface SyncExecutor {
  execute(input: { jobId: number; userId: number; runId: number }): Promise<SyncExecutorResult>;
}

export class PlaceholderSyncExecutor implements SyncExecutor {
  async execute(): Promise<SyncExecutorResult> {
    return {
      recordsProcessed: 0,
      recordsSucceeded: 0,
      recordsFailed: 0,
      resultJson: JSON.stringify({ message: 'Sync execution scaffolded. Integrate Google Sheets IO in next task.' })
    };
  }
}

export class SyncWorkerPool {
  private stopping = false;
  private workers: Promise<void>[] = [];

  constructor(
    private readonly logger: FastifyBaseLogger,
    private readonly syncQueue: SyncQueue,
    private readonly syncRunRepository: SyncRunRepository,
    private readonly syncJobRepository: SyncJobRepository,
    private readonly syncExecutor: SyncExecutor,
    private readonly concurrency: number,
    private readonly pollTimeoutSeconds: number
  ) {}

  start() {
    for (let i = 0; i < this.concurrency; i += 1) {
      this.workers.push(this.runWorker(i + 1));
    }

    this.logger.info({ concurrency: this.concurrency }, 'sync worker pool started');
  }

  async stop() {
    this.stopping = true;
    await Promise.all(this.workers);
    this.logger.info('sync worker pool stopped');
  }

  private async runWorker(workerId: number): Promise<void> {
    while (!this.stopping) {
      try {
        const message = await this.syncQueue.dequeueBlocking(this.pollTimeoutSeconds);

        if (!message) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          continue;
        }

        const claimed = this.syncRunRepository.markRunning(message.runId, message.userId, new Date().toISOString());
        if (!claimed) {
          this.logger.warn({ workerId, runId: message.runId }, 'skipped unclaimable sync run');
          continue;
        }

        try {
          const execution = await this.syncExecutor.execute({
            runId: message.runId,
            jobId: message.jobId,
            userId: message.userId
          });

          this.syncRunRepository.complete({
            id: message.runId,
            userId: message.userId,
            status: execution.recordsFailed > 0 ? 'failed' : 'succeeded',
            finishedAt: new Date().toISOString(),
            recordsProcessed: execution.recordsProcessed,
            recordsSucceeded: execution.recordsSucceeded,
            recordsFailed: execution.recordsFailed,
            resultJson: execution.resultJson ?? null,
            errorMessage: execution.recordsFailed > 0 ? 'Sync execution failed' : null,
            errorDetailsJson: null
          });

          this.syncJobRepository.updateLastRun({
            id: message.jobId,
            userId: message.userId,
            lastRunStatus: execution.recordsFailed > 0 ? 'failed' : 'succeeded',
            lastRunAt: new Date().toISOString(),
            lastErrorMessage: execution.recordsFailed > 0 ? 'Sync execution failed' : null
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Sync execution failed';
          const finishedAt = new Date().toISOString();

          this.syncRunRepository.complete({
            id: message.runId,
            userId: message.userId,
            status: 'failed',
            finishedAt,
            recordsProcessed: 0,
            recordsSucceeded: 0,
            recordsFailed: 0,
            resultJson: null,
            errorMessage,
            errorDetailsJson: null
          });

          this.syncJobRepository.updateLastRun({
            id: message.jobId,
            userId: message.userId,
            lastRunStatus: 'failed',
            lastRunAt: finishedAt,
            lastErrorMessage: errorMessage
          });

          this.logger.error({ workerId, runId: message.runId, error }, 'sync run execution failed');
        }
      } catch (error) {
        this.logger.error({ workerId, error }, 'sync worker iteration failed');
      }
    }
  }
}

export function workerPoolConfigFromEnv() {
  return {
    concurrency: env.SYNC_WORKER_CONCURRENCY,
    pollTimeoutSeconds: env.SYNC_WORKER_POLL_TIMEOUT_SEC
  };
}
