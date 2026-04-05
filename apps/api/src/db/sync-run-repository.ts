import type Database from 'better-sqlite3';
import type { CompleteSyncRunInput, CreateSyncRunInput, SyncRun } from '../models/sync-run.js';
import type { SyncRunStatus } from '../models/sync-job.js';

type SyncRunRow = {
  id: number;
  job_id: number;
  user_id: number;
  trigger_source: SyncRun['triggerSource'];
  status: SyncRunStatus;
  queue_message_id: string | null;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  records_processed: number;
  records_succeeded: number;
  records_failed: number;
  result_json: string | null;
  error_message: string | null;
  error_details_json: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: SyncRunRow): SyncRun {
  return {
    id: row.id,
    jobId: row.job_id,
    userId: row.user_id,
    triggerSource: row.trigger_source,
    status: row.status,
    queueMessageId: row.queue_message_id,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    recordsProcessed: row.records_processed,
    recordsSucceeded: row.records_succeeded,
    recordsFailed: row.records_failed,
    resultJson: row.result_json,
    errorMessage: row.error_message,
    errorDetailsJson: row.error_details_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SyncRunRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateSyncRunInput): SyncRun {
    const result = this.db
      .prepare(
        `INSERT INTO sync_runs
          (job_id, user_id, trigger_source, status, queue_message_id)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(input.jobId, input.userId, input.triggerSource, input.status, input.queueMessageId ?? null);

    const run = this.findByIdForUser(Number(result.lastInsertRowid), input.userId);

    if (!run) {
      throw new Error('Failed to create sync run');
    }

    return run;
  }

  findByIdForUser(id: number, userId: number): SyncRun | null {
    const row = this.db
      .prepare(
        `SELECT id, job_id, user_id, trigger_source, status, queue_message_id, queued_at, started_at, finished_at,
                records_processed, records_succeeded, records_failed, result_json, error_message, error_details_json,
                created_at, updated_at
         FROM sync_runs
         WHERE id = ? AND user_id = ?`
      )
      .get(id, userId) as SyncRunRow | undefined;

    return row ? mapRow(row) : null;
  }

  listByJobForUser(jobId: number, userId: number, limit = 20): SyncRun[] {
    const rows = this.db
      .prepare(
        `SELECT id, job_id, user_id, trigger_source, status, queue_message_id, queued_at, started_at, finished_at,
                records_processed, records_succeeded, records_failed, result_json, error_message, error_details_json,
                created_at, updated_at
         FROM sync_runs
         WHERE job_id = ? AND user_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      )
      .all(jobId, userId, limit) as SyncRunRow[];

    return rows.map(mapRow);
  }

  setQueueMessageId(id: number, userId: number, queueMessageId: string): boolean {
    const result = this.db
      .prepare(`UPDATE sync_runs SET queue_message_id = ? WHERE id = ? AND user_id = ?`)
      .run(queueMessageId, id, userId);

    return result.changes > 0;
  }

  markRunning(id: number, userId: number, startedAt: string): boolean {
    const result = this.db
      .prepare(`UPDATE sync_runs SET status = 'running', started_at = ? WHERE id = ? AND user_id = ? AND status = 'queued'`)
      .run(startedAt, id, userId);

    return result.changes > 0;
  }

  complete(input: CompleteSyncRunInput): boolean {
    const result = this.db
      .prepare(
        `UPDATE sync_runs
         SET status = ?,
             finished_at = ?,
             records_processed = ?,
             records_succeeded = ?,
             records_failed = ?,
             result_json = ?,
             error_message = ?,
             error_details_json = ?
         WHERE id = ? AND user_id = ?`
      )
      .run(
        input.status,
        input.finishedAt,
        input.recordsProcessed,
        input.recordsSucceeded,
        input.recordsFailed,
        input.resultJson ?? null,
        input.errorMessage ?? null,
        input.errorDetailsJson ?? null,
        input.id,
        input.userId
      );

    return result.changes > 0;
  }
}
