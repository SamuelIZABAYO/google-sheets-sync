import { env } from '../config/env.js';

export class UpstashRedisClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor() {
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
      throw new Error('Upstash Redis config missing');
    }

    this.baseUrl = env.UPSTASH_REDIS_REST_URL.replace(/\/$/, '');
    this.token = env.UPSTASH_REDIS_REST_TOKEN;
  }

  async setEx(key: string, ttlSeconds: number, value: string): Promise<void> {
    await this.call(['SETEX', key, String(ttlSeconds), value]);
  }

  async get(key: string): Promise<string | null> {
    const result = await this.call(['GET', key]);
    return typeof result === 'string' ? result : null;
  }

  async del(key: string): Promise<void> {
    await this.call(['DEL', key]);
  }

  private async call(command: string[]): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/pipeline`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify([command])
    });

    if (!response.ok) {
      throw new Error(`Upstash request failed: ${response.status}`);
    }

    const payload = (await response.json()) as Array<{ result?: unknown; error?: string }>;
    const first = payload[0];

    if (!first) {
      throw new Error('Upstash response malformed');
    }

    if (first.error) {
      throw new Error(`Upstash command failed: ${first.error}`);
    }

    return first.result;
  }
}
