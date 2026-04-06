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
│   ├── api/
│   │   ├── src/
│   │   ├── test/
│   │   └── Dockerfile
│   └── web/
│       ├── src/
│       ├── Dockerfile
│       └── nginx.conf
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

- `VITE_API_BASE_URL` (optional; empty uses same-origin routes behind Caddy)
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
npm run dev      # API
npm run dev:web  # Frontend (Vite)
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
- `npm run dev:web` — run Vite frontend
- `npm run build` — build API + frontend
- `npm run start` — start built API
- `npm run typecheck` — strict TS check (API + frontend)
- `npm run test` — run tests (API + frontend)


## Google OAuth2 endpoints (Task 3)

- `GET /auth/google/start` → returns `authorizationUrl` + CSRF `state`
- `GET /auth/google/callback?code=...&state=...` → exchanges code, fetches Google profile, stores encrypted access/refresh tokens, returns app JWT

Token storage details:
- OAuth state is stored with TTL in **Upstash Redis REST** when configured; otherwise falls back to SQLite table `oauth_states`.
- Google access/refresh tokens are encrypted at rest with `TOKEN_ENCRYPTION_KEY` (AES-256-GCM) in SQLite table `google_oauth_tokens`.
- Callback URL defaults to `https://APP_DOMAIN/auth/google/callback`, designed for **Caddy TLS** on Hetzner.
- Sync executor now auto-refreshes expired Google access tokens using the stored refresh token, then persists the new encrypted token and updated expiry.

## Job queue + workers (Task 6)

- `POST /sync-jobs/:id/run` enqueues a manual sync run and returns `202` with a queued run record.
- Sync run messages are pushed to an Upstash Redis list via REST (`LPUSH`/`BRPOP`).
- API process starts a background worker pool (`SYNC_WORKER_CONCURRENCY`) that long-polls queue and executes runs.
- Run lifecycle updates are persisted in SQLite (`sync_runs` + `sync_jobs.last_run_*`).

## Frontend dashboard shell + JWT auth (Task 9)

- React + Vite frontend lives in `apps/web`.
- Login form uses backend `POST /auth/login` and stores JWT access token in localStorage.
- On app load, frontend validates token with `GET /auth/me`.
- Protected dashboard route redirects unauthenticated users to `/login`.
- Dashboard form UX includes inline form-specific errors and JSON format helpers for config fields.
- Caddy routes API paths (`/auth*`, `/sync-jobs*`, `/health*`, `/webhooks*`) to the API container and all other paths to the frontend container.

## Cron scheduler process (Task 8)

- Background scheduler scans SQLite `sync_jobs` for active scheduled jobs (`trigger_type='schedule'`) at `SYNC_SCHEDULER_INTERVAL_SEC`.
- Cron expression format: standard 5-field UTC cron (`minute hour day month weekday`).
- For each due job, scheduler creates a queued `sync_runs` record and enqueues a message via Upstash Redis REST queue.
- Duplicate scheduling in the same minute is prevented using SQLite `sync_runs.queued_at` checks.
- Designed to run in the API process behind Caddy/HTTPS on Hetzner, with SQLite as system of record.

## Source connector support

The sync executor can now read source rows from:

- **SQLite** (default): `destinationConfig.source.type = "sqlite"`
- **PostgreSQL**: `destinationConfig.source.type = "postgres"`
- **REST API**: `destinationConfig.source.type = "rest"`

PostgreSQL source config is provided per sync job via `destinationConfig.source`:

```json
{
  "type": "postgres",
  "connectionString": "postgresql://USER:PASSWORD@HOST:5432/DB",
  "query": "SELECT id, name, amount FROM source_table WHERE amount >= $1",
  "params": [10],
  "ssl": { "enabled": true, "rejectUnauthorized": true }
}
```

REST source config is also provided per sync job via `destinationConfig.source`:

```json
{
  "type": "rest",
  "url": "https://api.example.com/orders",
  "method": "GET",
  "queryParams": { "status": "active", "limit": 100 },
  "responsePath": "data.items",
  "authTokenEnvVar": "REST_API_SOURCE_TOKEN"
}
```

Notes:
- For SQL sources, only read-only `SELECT` queries are accepted.
- If SQL `query` is omitted, the executor falls back to `SELECT * FROM <source.table || sourceSpreadsheetId>`.
- SSL is enabled by default for PostgreSQL sources; set `ssl.enabled=false` only for trusted local/private environments.
- REST sources enforce HTTPS by default (`allowInsecureHttp=false`) and support `GET`/`POST` methods.
- REST bearer auth can be injected via environment variable (`authTokenEnvVar`) to avoid storing API secrets in job config.

## Feature Roadmap & Prioritized Next Bets

This document outlines proposed next steps to evolve the platform beyond the MVP launch.

### Priority 1: Core Source & Trigger Enhancements
- Add support for additional source types:
  - PostgreSQL database connections
  - REST API data sources
  - CSV/Excel file imports
- Implement webhook triggers for real-time sync activation

### Priority 2: UX & Analytics Improvements
- Advanced data mapping and transformation UI
- Detailed run analytics and history views
- UI improvements for bulk job management and scheduling

### Priority 3: Collaboration & Notifications
- Multi-user/team support with role-based access control
- Real-time in-app notifications and email alerts for sync job statuses

### Priority 4: Monetization & Business
- Subscription and billing management
- Onboarding and workflow automation for new users
- Marketing site enhancements

### Other Technical Enhancements
- Improve security audits and monitoring
- Refine scalability for thousands of users and jobs
- Backup and disaster recovery plans

---
Updated: 2026-04-06
