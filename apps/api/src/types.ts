import type Database from 'better-sqlite3';
import type { AuthenticatedUser } from './auth/require-auth.js';

declare module 'fastify' {
  interface FastifyInstance {
    sqlite: Database.Database;
  }

  interface FastifyRequest {
    authUser?: AuthenticatedUser;
  }
}
