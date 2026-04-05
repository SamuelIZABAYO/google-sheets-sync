import type { FastifyInstance } from 'fastify';

export async function healthRoute(app: FastifyInstance) {
  app.get('/health', async () => {
    const row = app.sqlite.prepare('SELECT 1 as ok').get() as { ok: number };

    return {
      ok: row.ok === 1,
      service: 'google-sheets-sync-api'
    };
  });
}
