import type { SyncJobRepository } from '../db/sync-job-repository.js';
import type { SyncRunRepository } from '../db/sync-run-repository.js';
import type { SyncTriggerSource } from '../models/sync-run.js';
import type { SyncQueue } from './sync-queue.js';

export class SyncJobInactiveError extends Error {}
export class QueueUnavailableError extends Error {}
export class SyncJobNotFoundError extends Error {}

export class SyncRunService {
  constructor(
    private readonly syncJobRepository: SyncJobRepository,
    private readonly syncRunRepository: SyncRunRepository,
    private readonly syncQueue: SyncQueue | null
  ) {}

  async enqueueRun(jobId: number, userId: number, triggerSource: SyncTriggerSource) {
    const job = this.syncJobRepository.findByIdForUser(jobId, userId);

    if (!job) {
      throw new SyncJobNotFoundError('Sync job not found');
    }

    if (job.status !== 'active') {
      throw new SyncJobInactiveError('Sync job is not active');
    }

    if (!this.syncQueue) {
      throw new QueueUnavailableError('Queue unavailable');
    }

    const run = this.syncRunRepository.create({
      jobId,
      userId,
      triggerSource,
      status: 'queued'
    });

    const message = {
      runId: run.id,
      jobId,
      userId,
      triggerSource,
      queuedAt: run.queuedAt
    } as const;

    const queueMessageId = await this.syncQueue.enqueue(message);
    this.syncRunRepository.setQueueMessageId(run.id, userId, queueMessageId);

    const queuedRun = this.syncRunRepository.findByIdForUser(run.id, userId);

    if (!queuedRun) {
      throw new Error('Failed to load queued run');
    }

    return queuedRun;
  }
}
