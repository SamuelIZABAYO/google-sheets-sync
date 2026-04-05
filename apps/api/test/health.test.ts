import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { healthRoute } from '../src/routes/health.js';

describe('health route', () => {
  const app = Fastify();
  const sqlite = new Database(':memory:');

  beforeAll(async () => {
    app.decorate('sqlite', sqlite);
    await app.register(healthRoute);
  });

  afterAll(async () => {
    await app.close();
    sqlite.close();
  });

  it('returns ok=true', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      service: 'google-sheets-sync-api'
    });
  });
});
