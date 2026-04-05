import { env } from '../config/env.js';
import { OauthStateRepository } from '../db/oauth-state-repository.js';
import { UpstashRedisClient } from './upstash-redis-client.js';

const OAUTH_STATE_TTL_SECONDS = 600;
const OAUTH_STATE_PREFIX = 'oauth:state:';

export class OauthStateStore {
  private readonly redisClient: UpstashRedisClient | null;

  constructor(private readonly sqliteRepo: OauthStateRepository) {
    this.redisClient = env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN ? new UpstashRedisClient() : null;
  }

  async save(state: string): Promise<void> {
    if (this.redisClient) {
      await this.redisClient.setEx(`${OAUTH_STATE_PREFIX}${state}`, OAUTH_STATE_TTL_SECONDS, '1');
      return;
    }

    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_SECONDS * 1000).toISOString();
    this.sqliteRepo.save(state, expiresAt);
  }

  async consume(state: string): Promise<boolean> {
    if (this.redisClient) {
      const key = `${OAUTH_STATE_PREFIX}${state}`;
      const value = await this.redisClient.get(key);
      if (!value) {
        return false;
      }
      await this.redisClient.del(key);
      return true;
    }

    return this.sqliteRepo.consume(state);
  }
}
