import { env } from '../config/env.js';
import { UpstashRedisClient } from './upstash-redis-client.js';

export type SyncQueueMessage = {
  runId: number;
  jobId: number;
  userId: number;
  triggerSource: 'manual' | 'schedule' | 'webhook' | 'retry';
  queuedAt: string;
};

export interface SyncQueue {
  enqueue(message: SyncQueueMessage): Promise<string>;
  dequeueBlocking(timeoutSeconds: number): Promise<SyncQueueMessage | null>;
}

export class UpstashSyncQueue implements SyncQueue {
  constructor(
    private readonly redis: UpstashRedisClient,
    private readonly queueKey: string
  ) {}

  async enqueue(message: SyncQueueMessage): Promise<string> {
    const payload = JSON.stringify(message);
    const queueMessageId = `${message.runId}:${Date.now()}`;

    await this.redis.lpush(this.queueKey, payload);

    return queueMessageId;
  }

  async dequeueBlocking(timeoutSeconds: number): Promise<SyncQueueMessage | null> {
    const value = await this.redis.brpop(this.queueKey, timeoutSeconds);

    if (!value) {
      return null;
    }

    const parsed = JSON.parse(value) as SyncQueueMessage;

    return parsed;
  }
}

export function createSyncQueueFromEnv(): SyncQueue | null {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }

  return new UpstashSyncQueue(new UpstashRedisClient(), env.SYNC_QUEUE_KEY);
}
