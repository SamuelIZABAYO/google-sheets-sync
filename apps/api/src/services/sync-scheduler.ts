import type { FastifyBaseLogger } from 'fastify';
import { env } from '../config/env.js';
import type { SyncJob } from '../models/sync-job.js';
import type { SyncJobRepository } from '../db/sync-job-repository.js';
import type { SyncRunRepository } from '../db/sync-run-repository.js';
import type { SyncQueue } from './sync-queue.js';

type CronField = {
  values: Set<number>;
};

function parseNumericToken(token: string, min: number, max: number): number {
  const value = Number(token);

  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid cron value: ${token}`);
  }

  return value;
}

function parseCronField(field: string, min: number, max: number): CronField {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    const token = part.trim();

    if (!token) {
      throw new Error('Empty cron token');
    }

    const [base, stepRaw] = token.split('/');
    const step = stepRaw === undefined ? 1 : parseNumericToken(stepRaw, 1, max - min + 1);

    let start = min;
    let end = max;

    if (base !== '*') {
      if (base.includes('-')) {
        const [startRaw, endRaw] = base.split('-');
        if (!startRaw || !endRaw) {
          throw new Error(`Invalid cron range: ${base}`);
        }
        start = parseNumericToken(startRaw, min, max);
        end = parseNumericToken(endRaw, min, max);
      } else {
        const fixed = parseNumericToken(base, min, max);
        start = fixed;
        end = fixed;
      }
    }

    if (start > end) {
      throw new Error(`Invalid cron range order: ${base}`);
    }

    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }

  return { values };
}

function normalizeDayOfWeek(value: number): number {
  return value === 7 ? 0 : value;
}

function compileCronExpression(cronExpression: string) {
  const parts = cronExpression.trim().split(/\s+/);

  if (parts.length !== 5) {
    throw new Error('Cron expression must contain exactly 5 fields');
  }

  const minute = parseCronField(parts[0], 0, 59);
  const hour = parseCronField(parts[1], 0, 23);
  const dayOfMonth = parseCronField(parts[2], 1, 31);
  const month = parseCronField(parts[3], 1, 12);
  const dayOfWeekRaw = parseCronField(parts[4], 0, 7);
  const dayOfWeek = new Set(Array.from(dayOfWeekRaw.values).map(normalizeDayOfWeek));

  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek
  };
}

export function isCronExpressionValid(cronExpression: string): boolean {
  try {
    compileCronExpression(cronExpression);
    return true;
  } catch {
    return false;
  }
}

export function isCronExpressionDue(cronExpression: string, now: Date): boolean {
  try {
    const compiled = compileCronExpression(cronExpression);

    return (
      compiled.minute.values.has(now.getUTCMinutes()) &&
      compiled.hour.values.has(now.getUTCHours()) &&
      compiled.dayOfMonth.values.has(now.getUTCDate()) &&
      compiled.month.values.has(now.getUTCMonth() + 1) &&
      compiled.dayOfWeek.has(now.getUTCDay())
    );
  } catch {
    return false;
  }
}

function minuteWindowStartIso(now: Date): string {
  const start = new Date(now);
  start.setUTCSeconds(0, 0);
  return start.toISOString();
}

export class SyncScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly logger: FastifyBaseLogger,
    private readonly syncJobRepository: SyncJobRepository,
    private readonly syncRunRepository: SyncRunRepository,
    private readonly syncQueue: SyncQueue,
    private readonly intervalMs: number
  ) {}

  start() {
    if (this.timer) {
      return;
    }

    void this.tick();

    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);

    this.logger.info({ intervalMs: this.intervalMs }, 'sync scheduler started');
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    this.logger.info('sync scheduler stopped');
  }

  async tick(now = new Date()): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      const scheduledJobs = this.syncJobRepository.listActiveScheduled();
      const minuteStart = minuteWindowStartIso(now);

      for (const job of scheduledJobs) {
        if (!this.shouldEnqueue(job, now)) {
          continue;
        }

        const alreadyQueuedThisMinute = this.syncRunRepository.hasRunQueuedSince(job.id, job.userId, minuteStart);
        if (alreadyQueuedThisMinute) {
          continue;
        }

        const run = this.syncRunRepository.create({
          jobId: job.id,
          userId: job.userId,
          triggerSource: 'schedule',
          status: 'queued'
        });

        const queueMessageId = await this.syncQueue.enqueue({
          runId: run.id,
          jobId: job.id,
          userId: job.userId,
          triggerSource: 'schedule',
          queuedAt: run.queuedAt
        });

        this.syncRunRepository.setQueueMessageId(run.id, job.userId, queueMessageId);

        this.logger.info({ jobId: job.id, userId: job.userId, runId: run.id }, 'scheduled sync run enqueued');
      }
    } catch (error) {
      this.logger.error({ error }, 'sync scheduler tick failed');
    } finally {
      this.running = false;
    }
  }

  private shouldEnqueue(job: SyncJob, now: Date): boolean {
    if (!job.cronExpression) {
      return false;
    }

    if (!isCronExpressionValid(job.cronExpression)) {
      this.logger.warn({ jobId: job.id, cronExpression: job.cronExpression }, 'invalid cron expression');
      return false;
    }

    return isCronExpressionDue(job.cronExpression, now);
  }
}

export function schedulerConfigFromEnv() {
  return {
    enabled: env.SYNC_SCHEDULER_ENABLED,
    intervalMs: env.SYNC_SCHEDULER_INTERVAL_SEC * 1000
  };
}
