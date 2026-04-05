import type Database from 'better-sqlite3';

declare module 'fastify' {
  interface FastifyInstance {
    sqlite: Database.Database;
  }
}
