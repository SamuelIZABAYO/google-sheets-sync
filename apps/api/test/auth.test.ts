import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import type { authRoutes as AuthRoutes } from '../src/routes/auth.js';

const JWT_SECRET = 'test-secret-key-with-32-characters!!';

describe('auth routes', () => {
  const app = Fastify();
  const sqlite = new Database(':memory:');
  let authRoutes: typeof AuthRoutes;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_EXPIRES_IN = '1h';
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
    process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
    process.env.APP_DOMAIN = 'app.automationglass.com';

    sqlite.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        auth_provider TEXT NOT NULL DEFAULT 'local',
        google_sub TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE oauth_states (
        state TEXT PRIMARY KEY,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE google_oauth_tokens (
        user_id INTEGER PRIMARY KEY,
        google_sub TEXT NOT NULL,
        encrypted_access_token TEXT NOT NULL,
        encrypted_refresh_token TEXT,
        scope TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    ({ authRoutes } = await import('../src/routes/auth.js'));

    app.decorate('sqlite', sqlite);
    await app.register(authRoutes);
  });

  afterAll(async () => {
    await app.close();
    sqlite.close();
  });

  it('registers a user and returns a token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'user@example.com',
        password: 'Password123!'
      }
    });

    expect(response.statusCode).toBe(201);

    const body = response.json() as { accessToken: string; user: { email: string } };
    expect(body.accessToken).toBeTypeOf('string');
    expect(body.user.email).toBe('user@example.com');
  });

  it('returns 401 on invalid login credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'user@example.com',
        password: 'wrong-password'
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: 'Invalid email or password'
    });
  });

  it('returns authorization URL for google oauth start', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/google/start' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { authorizationUrl: string; state: string };
    expect(body.state.length).toBeGreaterThan(10);
    expect(body.authorizationUrl).toContain('accounts.google.com/o/oauth2/v2/auth');
    expect(body.authorizationUrl).toContain(`state=${body.state}`);
  });

  it('rejects google callback when state is invalid', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/google/callback?code=fake-code&state=invalid-state'
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Invalid OAuth state' });
  });

  it('returns 401 for /auth/me without token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me'
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns user from /auth/me with valid token', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'user@example.com',
        password: 'Password123!'
      }
    });

    const token = (login.json() as { accessToken: string }).accessToken;

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(me.statusCode).toBe(200);
    const body = me.json() as { user: { email: string } };
    expect(body.user.email).toBe('user@example.com');
  });
});
