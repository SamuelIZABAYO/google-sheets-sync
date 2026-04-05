# Google Sheets Sync-as-a-Service

Monorepo scaffold for the Google Sheets Sync service.

## Architecture (Task 1 baseline)

- **Host:** Hetzner VPS
- **Public domain:** `app.automationglass.com`
- **API:** Fastify (Node.js + TypeScript)
- **Database:** SQLite
- **Queue/cache (next step):** Upstash Redis REST API
- **TLS + reverse proxy:** Caddy (automatic HTTPS)
- **Service port:** `3001`

## Project structure

```text
.
├── apps/
│   └── api/
│       ├── src/
│       │   ├── config/
│       │   ├── db/
│       │   ├── routes/
│       │   └── index.ts
│       ├── test/
│       └── Dockerfile
├── Caddyfile
├── docker-compose.yml
├── package.json
└── .env.example
```

## Environment variables

Copy and fill values:

```bash
cp .env.example .env
```

Required vars:

- `HOST` (default `0.0.0.0`)
- `PORT` (default `3001`)
- `APP_DOMAIN` (default `app.automationglass.com`)
- `DATABASE_PATH` (default `/data/app.db`)
- `JWT_SECRET` (**required**, min 32 chars)
- `JWT_EXPIRES_IN` (default `7d`)
- `UPSTASH_REDIS_REST_URL` (required for Redis queue + OAuth state)
- `UPSTASH_REDIS_REST_TOKEN` (required for Redis queue + OAuth state)
- `SYNC_QUEUE_KEY` (default `sync-jobs`)
- `SYNC_WORKER_CONCURRENCY` (default `2`)
- `SYNC_WORKER_POLL_TIMEOUT_SEC` (default `15`)
- `SYNC_SCHEDULER_ENABLED` (default `true`)
- `SYNC_SCHEDULER_INTERVAL_SEC` (default `30`)

## Local development

```bash
npm install
npm run dev
```

Health check:

```bash
curl http://localhost:3001/health
```

Expected:

```json
{"ok":true,"service":"google-sheets-sync-api"}
```

Auth endpoints:

```bash
curl -X POST http://localhost:3001/auth/register \
  -H "content-type: application/json" \
  -d '{"email":"user@example.com","password":"Password123!"}'

curl -X POST http://localhost:3001/auth/login \
  -H "content-type: application/json" \
  -d '{"email":"user@example.com","password":"Password123!"}'
```

## Run with Docker + Caddy

```bash
cp .env.example .env
# Fill Upstash values in .env before starting
APP_DOMAIN=app.automationglass.com docker compose up -d --build
```

Caddy will automatically provision HTTPS certificates for `APP_DOMAIN` when DNS points to the server.

## Scripts

From repo root:

- `npm run dev` — run API in watch mode
- `npm run build` — build API
- `npm run start` — start built API
- `npm run typecheck` — strict TS check
- `npm run test` — run tests


## Google OAuth2 endpoints (Task 3)

-  → returns  + CSRF 
-  → exchanges code, fetches Google profile, stores encrypted access/refresh tokens, returns app JWT

Token storage details:
- OAuth state is stored with TTL in **Upstash Redis REST** when configured; otherwise falls back to SQLite table .
- Google access/refresh tokens are encrypted at rest with  (AES-256-GCM) in SQLite table .
- Callback URL defaults to , designed for **Caddy TLS** on Hetzner.

## Google OAuth2 endpoints (Task 3)

- `GET /auth/google/start` → returns `authorizationUrl` + CSRF `state`
- `GET /auth/google/callback?code=...&state=...` → exchanges code, fetches Google profile, stores encrypted access/refresh tokens, returns app JWT

Token storage details:
- OAuth state is stored with TTL in **Upstash Redis REST** when configured; otherwise falls back to SQLite table `oauth_states`.
- Google access/refresh tokens are encrypted at rest with `TOKEN_ENCRYPTION_KEY` (AES-256-GCM) in SQLite table `google_oauth_tokens`.
- Callback URL defaults to `https://APP_DOMAIN/auth/google/callback`, designed for **Caddy TLS** on Hetzner.

## Job queue + workers (Task 6)

- `POST /sync-jobs/:id/run` enqueues a manual sync run and returns `202` with a queued run record.
- Sync run messages are pushed to an Upstash Redis list via REST (`LPUSH`/`BRPOP`).
- API process starts a background worker pool (`SYNC_WORKER_CONCURRENCY`) that long-polls queue and executes runs.
- Run lifecycle updates are persisted in SQLite (`sync_runs` + `sync_jobs.last_run_*`).

## Cron scheduler process (Task 8)

- Background scheduler scans SQLite `sync_jobs` for active scheduled jobs (`trigger_type='schedule'`) at `SYNC_SCHEDULER_INTERVAL_SEC`.
- Cron expression format: standard 5-field UTC cron (`minute hour day month weekday`).
- For each due job, scheduler creates a queued `sync_runs` record and enqueues a message via Upstash Redis REST queue.
- Duplicate scheduling in the same minute is prevented using SQLite `sync_runs.queued_at` checks.
- Designed to run in the API process behind Caddy/HTTPS on Hetzner, with SQLite as system of record.
