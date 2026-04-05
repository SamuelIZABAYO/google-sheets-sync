# Review Request — Task 6: Job Queue & Worker Setup

## What was built
Implemented Redis-backed sync run queueing using Upstash Redis REST and added a scalable in-process worker pool for background execution. Added authenticated API trigger endpoint to enqueue runs and persist lifecycle transitions in SQLite. Added tests covering queueing behavior and worker processing.

## PR
Pending (to be created after push)

## Files changed
- `.env.example`: added queue/worker env vars.
- `README.md`: documented Task 6 queue + worker behavior and endpoint.
- `apps/api/src/config/env.ts`: added queue key, worker concurrency, and poll timeout config.
- `apps/api/src/services/upstash-redis-client.ts`: added `LPUSH`/`BRPOP` command support.
- `apps/api/src/services/sync-queue.ts`: new queue abstraction + Upstash implementation.
- `apps/api/src/services/sync-run-service.ts`: new service to validate/enqueue manual runs.
- `apps/api/src/services/sync-worker-pool.ts`: new scalable worker pool + placeholder executor.
- `apps/api/src/app.ts`: wired queue creation, Fastify decoration, worker pool startup/shutdown hooks.
- `apps/api/src/types.ts`: added `syncQueue` Fastify instance typing.
- `apps/api/src/routes/sync-jobs.ts`: added `POST /sync-jobs/:id/run` endpoint.
- `apps/api/src/db/sync-run-repository.ts`: added queue message ID update and safe claim semantics.
- `apps/api/src/db/sync-job-repository.ts`: restored/generalized update + delete methods used by service layer.
- `apps/api/test/sync-jobs-api.test.ts`: added queue-run endpoint test coverage.
- `apps/api/test/sync-worker-pool.test.ts`: added worker processing integration test.

## Security checklist
- [x] No hardcoded secrets
- [x] No injection vectors
- [x] Auth on all new endpoints
- [x] Input validated at boundary
- [x] Errors don't expose internals
- [x] Bcrypt used for any passwords
- [x] Dependency audit: PASSED

## Tests
- Unit: `apps/api/test/sync-worker-pool.test.ts`
- Integration: `apps/api/test/sync-jobs-api.test.ts`
- Type check: PASSED (`npm run typecheck`)
- Test suite: PASSED (`npm run test`)

## Migration notes
- DB changes: None (uses existing sync_runs/sync_jobs schema)
- Breaking API changes: None (additive endpoint only)

## Rollback
- How to undo: revert this task commit, redeploy API process.
- Data loss: NO

## Self-assessed risks
- Worker currently uses a placeholder sync executor scaffold; actual Google Sheets read/write execution logic remains for the next task.
- In-process workers scale per API instance; if multiple instances run, ensure idempotent execution expectations are maintained (claiming guard added via queued→running transition).

## Task spec reference
Start Task 6: Job Queue & Worker Setup. Implement Redis-backed job queue integration with Upstash Redis REST API and a scalable pool of background workers to execute sync jobs. Adapt to updated architecture with SQLite backend, Hetzner deployment, and Caddy HTTPS.
