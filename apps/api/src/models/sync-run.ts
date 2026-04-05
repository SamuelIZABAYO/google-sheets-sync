import type { SyncRunStatus } from './sync-job.js';

export type SyncTriggerSource = 'manual' | 'schedule' | 'webhook' | 'retry';

export type SyncRun = {
  id: number;
  jobId: number;
  userId: number;
  triggerSource: SyncTriggerSource;
  status: SyncRunStatus;
  queueMessageId: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  recordsProcessed: number;
  recordsSucceeded: number;
  recordsFailed: number;
  resultJson: string | null;
  errorMessage: string | null;
  errorDetailsJson: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateSyncRunInput = {
  jobId: number;
  userId: number;
  triggerSource: SyncTriggerSource;
  status: SyncRunStatus;
  queueMessageId?: string | null;
};

export type CompleteSyncRunInput = {
  id: number;
  userId: number;
  status: Extract<SyncRunStatus, 'succeeded' | 'failed' | 'cancelled'>;
  finishedAt: string;
  recordsProcessed: number;
  recordsSucceeded: number;
  recordsFailed: number;
  resultJson?: string | null;
  errorMessage?: string | null;
  errorDetailsJson?: string | null;
};
