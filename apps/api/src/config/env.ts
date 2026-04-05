import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),
  APP_DOMAIN: z.string().default('app.automationglass.com'),
  DATABASE_PATH: z.string().default('/data/app.db'),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  SYNC_QUEUE_KEY: z.string().min(1).default('sync-jobs'),
  SYNC_WORKER_CONCURRENCY: z.coerce.number().int().positive().max(32).default(2),
  SYNC_WORKER_POLL_TIMEOUT_SEC: z.coerce.number().int().min(1).max(60).default(15),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_OAUTH_SCOPES: z.string().default('openid email profile https://www.googleapis.com/auth/spreadsheets.readonly'),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().min(1)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export function getGoogleRedirectUri(): string {
  if (env.GOOGLE_OAUTH_REDIRECT_URI) {
    return env.GOOGLE_OAUTH_REDIRECT_URI;
  }

  const domain = env.APP_DOMAIN.replace(/\/$/, '');
  return `https://${domain}/auth/google/callback`;
}
