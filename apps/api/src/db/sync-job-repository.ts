import type Database from 'better-sqlite3';
import type {
  CreateSyncJobInput,
  SyncJob,
  SyncJobStatus,
  UpdateSyncJobLastRunInput,
  UpdateSyncJobStatusInput
} from '../models/sync-job.js';

export type UpdateSyncJobRepositoryInput = {
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

  listActiveScheduled(): SyncJob[] {
    const rows = this.db
      .prepare(
        `SELECT id, user_id, name, status, source_spreadsheet_id, source_sheet_name, destination_type, destination_config_json,
                field_mapping_json, trigger_type, trigger_config_json, cron_expression, queue_topic, last_run_status,
                last_run_at, last_error_message, created_at, updated_at
         FROM sync_jobs
         WHERE status = 'active' AND trigger_type = 'schedule' AND cron_expression IS NOT NULL AND trim(cron_expression) <> ''
         ORDER BY id ASC`
      )
      .all() as SyncJobRow[];

    return rows.map(mapRow);
  }

  update(input: UpdateSyncJobRepositoryInput): SyncJob | null {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      values.push(input.name);
    }

    if (input.status !== undefined) {
      updates.push('status = ?');
      values.push(input.status);
    }

    if (input.sourceSpreadsheetId !== undefined) {
      updates.push('source_spreadsheet_id = ?');
      values.push(input.sourceSpreadsheetId);
    }

    if (input.sourceSheetName !== undefined) {
      updates.push('source_sheet_name = ?');
      values.push(input.sourceSheetName);
    }

    if (input.destinationType !== undefined) {
      updates.push('destination_type = ?');
      values.push(input.destinationType);
    }

    if (input.destinationConfigJson !== undefined) {
      updates.push('destination_config_json = ?');
      values.push(input.destinationConfigJson);
    }

    if (input.fieldMappingJson !== undefined) {
      updates.push('field_mapping_json = ?');
      values.push(input.fieldMappingJson);
    }

    if (input.triggerType !== undefined) {
      updates.push('trigger_type = ?');
      values.push(input.triggerType);
    }

    if (input.triggerConfigJson !== undefined) {
      updates.push('trigger_config_json = ?');
      values.push(input.triggerConfigJson);
    }

    if (input.cronExpression !== undefined) {
      updates.push('cron_expression = ?');
      values.push(input.cronExpression);
    }

    if (input.queueTopic !== undefined) {
      updates.push('queue_topic = ?');
      values.push(input.queueTopic);
    }

    if (updates.length === 0) {
      return this.findByIdForUser(input.id, input.userId);
    }

    values.push(input.id, input.userId);

    const result = this.db
      .prepare(`UPDATE sync_jobs SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`)
      .run(...values);

    if (result.changes === 0) {
      return null;
    }

    return this.findByIdForUser(input.id, input.userId);
  }

  delete(id: number, userId: number): boolean {
    const result = this.db.prepare('DELETE FROM sync_jobs WHERE id = ? AND user_id = ?').run(id, userId);

    return result.changes > 0;
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
