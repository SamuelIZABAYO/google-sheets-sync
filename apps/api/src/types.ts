import type Database from 'better-sqlite3';
import type { AuthenticatedUser } from './auth/require-auth.js';
import type { SyncQueue } from './services/sync-queue.js';

declare module 'fastify' {
  interface FastifyInstance {
    sqlite: Database.Database;
    syncQueue: SyncQueue | null;
  }

  interface FastifyRequest {
    authUser?: AuthenticatedUser;
  }
}
