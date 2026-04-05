import Fastify from 'fastify';
import { createDatabase } from './db/sqlite.js';
import { healthRoute } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { syncJobRoutes } from './routes/sync-jobs.js';
import './types.js';

export function buildApp() {
  const app = Fastify({ logger: true });
  const db = createDatabase();

  app.decorate('sqlite', db);

  app.get('/', async () => ({
    ok: true,
    message: 'Google Sheets Sync API is running'
  }));

  app.register(healthRoute);
  app.register(authRoutes);
  app.register(syncJobRoutes);

  app.addHook('onClose', async () => {
    db.close();
  });

  return app;
}
