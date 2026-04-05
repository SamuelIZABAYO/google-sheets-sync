import type { SyncJobRepository } from '../db/sync-job-repository.js';
import type { CreateSyncJobInput, SyncJob, SyncJobStatus } from '../models/sync-job.js';

export type UpdateSyncJobInput = {
  id: number;
  userId: number;
  name?: string;
  status?: SyncJobStatus;
  sourceSpreadsheetId?: string;
  sourceSheetName?: string | null;
  destinationType?: string;
  destinationConfigJson?: string;
  fieldMappingJson?: string;
  triggerType?: SyncJob['triggerType'];
  triggerConfigJson?: string | null;
  cronExpression?: string | null;
  queueTopic?: string;
};

export class SyncJobNotFoundError extends Error {}

export class SyncJobService {
  constructor(private readonly syncJobRepository: SyncJobRepository) {}

  listForUser(userId: number): SyncJob[] {
    return this.syncJobRepository.listByUser(userId);
  }

  create(input: CreateSyncJobInput): SyncJob {
    return this.syncJobRepository.create(input);
  }

  update(input: UpdateSyncJobInput): SyncJob {
    const updated = this.syncJobRepository.update(input);

    if (!updated) {
      throw new SyncJobNotFoundError('Sync job not found');
    }

    return updated;
  }

  delete(id: number, userId: number): void {
    const deleted = this.syncJobRepository.delete(id, userId);

    if (!deleted) {
      throw new SyncJobNotFoundError('Sync job not found');
    }
  }
}
