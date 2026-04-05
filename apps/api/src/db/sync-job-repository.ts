import type Database from 'better-sqlite3';
import type {
  CreateSyncJobInput,
  SyncJob,
  SyncJobStatus,
  UpdateSyncJobLastRunInput,
  UpdateSyncJobStatusInput
} from '../models/sync-job.js';

type SyncJobRow = {
  id: number;
  user_id: number;
  name: string;
  status: SyncJobStatus;
  source_spreadsheet_id: string;
  source_sheet_name: string | null;
  destination_type: string;
  destination_config_json: string;
  field_mapping_json: string;
  trigger_type: SyncJob['triggerType'];
  trigger_config_json: string | null;
  cron_expression: string | null;
  queue_topic: string;
  last_run_status: SyncJob['lastRunStatus'];
  last_run_at: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: SyncJobRow): SyncJob {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    status: row.status,
    sourceSpreadsheetId: row.source_spreadsheet_id,
    sourceSheetName: row.source_sheet_name,
    destinationType: row.destination_type,
    destinationConfigJson: row.destination_config_json,
    fieldMappingJson: row.field_mapping_json,
    triggerType: row.trigger_type,
    triggerConfigJson: row.trigger_config_json,
    cronExpression: row.cron_expression,
    queueTopic: row.queue_topic,
    lastRunStatus: row.last_run_status,
    lastRunAt: row.last_run_at,
    lastErrorMessage: row.last_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SyncJobRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateSyncJobInput): SyncJob {
    const result = this.db
      .prepare(
        `INSERT INTO sync_jobs
          (user_id, name, source_spreadsheet_id, source_sheet_name, destination_type, destination_config_json, field_mapping_json, trigger_type, trigger_config_json, cron_expression, queue_topic)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.userId,
        input.name,
        input.sourceSpreadsheetId,
        input.sourceSheetName ?? null,
        input.destinationType,
        input.destinationConfigJson,
        input.fieldMappingJson,
        input.triggerType ?? 'manual',
        input.triggerConfigJson ?? null,
        input.cronExpression ?? null,
        input.queueTopic ?? 'sync-jobs'
      );

    const job = this.findByIdForUser(Number(result.lastInsertRowid), input.userId);

    if (!job) {
      throw new Error('Failed to create sync job');
    }

    return job;
  }

  findByIdForUser(id: number, userId: number): SyncJob | null {
    const row = this.db
      .prepare(
        `SELECT id, user_id, name, status, source_spreadsheet_id, source_sheet_name, destination_type, destination_config_json,
                field_mapping_json, trigger_type, trigger_config_json, cron_expression, queue_topic, last_run_status,
                last_run_at, last_error_message, created_at, updated_at
         FROM sync_jobs
         WHERE id = ? AND user_id = ?`
      )
      .get(id, userId) as SyncJobRow | undefined;

    return row ? mapRow(row) : null;
  }

  listByUser(userId: number): SyncJob[] {
    const rows = this.db
      .prepare(
        `SELECT id, user_id, name, status, source_spreadsheet_id, source_sheet_name, destination_type, destination_config_json,
                field_mapping_json, trigger_type, trigger_config_json, cron_expression, queue_topic, last_run_status,
                last_run_at, last_error_message, created_at, updated_at
         FROM sync_jobs
         WHERE user_id = ?
         ORDER BY updated_at DESC, id DESC`
      )
      .all(userId) as SyncJobRow[];

    return rows.map(mapRow);
  }

  updateStatus(input: UpdateSyncJobStatusInput): boolean {
    const result = this.db
      .prepare('UPDATE sync_jobs SET status = ? WHERE id = ? AND user_id = ?')
      .run(input.status, input.id, input.userId);

    return result.changes > 0;
  }

  updateLastRun(input: UpdateSyncJobLastRunInput): boolean {
    const result = this.db
      .prepare(
        `UPDATE sync_jobs
         SET last_run_status = ?, last_run_at = ?, last_error_message = ?
         WHERE id = ? AND user_id = ?`
      )
      .run(input.lastRunStatus, input.lastRunAt, input.lastErrorMessage ?? null, input.id, input.userId);

    return result.changes > 0;
  }
}
