export type SyncJobStatus = 'active' | 'paused' | 'archived';
export type SyncTriggerType = 'manual' | 'schedule' | 'webhook';
export type SyncRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type SyncJob = {
  id: number;
  userId: number;
  name: string;
  status: SyncJobStatus;
  sourceSpreadsheetId: string;
  sourceSheetName: string | null;
  destinationType: string;
  destinationConfigJson: string;
  fieldMappingJson: string;
  triggerType: SyncTriggerType;
  triggerConfigJson: string | null;
  cronExpression: string | null;
  queueTopic: string;
  lastRunStatus: SyncRunStatus | null;
  lastRunAt: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateSyncJobInput = {
  userId: number;
  name: string;
  sourceSpreadsheetId: string;
  sourceSheetName?: string | null;
  destinationType: string;
  destinationConfigJson: string;
  fieldMappingJson: string;
  triggerType?: SyncTriggerType;
  triggerConfigJson?: string | null;
  cronExpression?: string | null;
  queueTopic?: string;
};

export type UpdateSyncJobStatusInput = {
  id: number;
  userId: number;
  status: SyncJobStatus;
};

export type UpdateSyncJobLastRunInput = {
  id: number;
  userId: number;
  lastRunStatus: SyncRunStatus;
  lastRunAt: string;
  lastErrorMessage?: string | null;
};
