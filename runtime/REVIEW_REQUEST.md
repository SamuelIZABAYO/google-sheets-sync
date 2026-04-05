# Review Request — Task 4: Sync Job & Run Models (DB Schema)

## What was built
Implemented SQLite schema upgrades for `sync_jobs` and new `sync_runs` with trigger/status/result history fields, ownership scoping, and indexes. Added strongly-typed sync job/run models and repositories with user-scoped access methods to prevent cross-user data access. Added integration tests validating schema, CRUD flow, run lifecycle, and security boundaries.

## PR
Pending push/PR creation by main agent.

## Files changed
- `apps/api/src/db/sqlite.ts`: expanded sync schema, migration guards for legacy DBs, run table + triggers + indexes
- `apps/api/src/models/sync-job.ts`: sync job types and status/trigger enums
- `apps/api/src/models/sync-run.ts`: sync run types and lifecycle input models
- `apps/api/src/db/sync-job-repository.ts`: user-scoped sync job data access methods
- `apps/api/src/db/sync-run-repository.ts`: user-scoped sync run history lifecycle methods
- `apps/api/test/sync-models.test.ts`: integration tests for schema + repositories + cross-user isolation

## Security checklist
- [x] No hardcoded secrets
- [x] No injection vectors
- [x] Auth on all new endpoints
- [x] Input validated at boundary
- [x] Errors don't expose internals
- [x] Bcrypt used for any passwords
- [x] Dependency audit: PASSED

## Tests
- Unit: None — repository/model work validated with integration-level DB tests
- Integration: `apps/api/test/sync-models.test.ts`
- Manual steps:
  1. `npm run typecheck` → passes
  2. `npm run test` → all tests pass
  3. `npm audit --audit-level=high` → no vulnerabilities
- Type check: PASSED
- Test suite: PASSED

## Migration notes
- DB changes: `sync_jobs` expanded with ownership/config/trigger/run summary columns; `sync_runs` table added for run history
- Breaking API changes: None (no existing sync API handlers yet)

## Rollback
- How to undo: revert this commit and redeploy previous image
- Data loss: NO (adds columns/tables only)

## Self-assessed risks
- Legacy databases with `sync_jobs` rows created before `user_id` existed may need backfill strategy before enforcing NOT NULL at app/API layer.

## Task spec reference
Task 4: Sync Job & Run Models (DB Schema) — implement SQLite schema and models for sync jobs/runs including config, triggers, status, run results/history, compatibility with existing user/auth, and secure data access aligned to Hetzner + SQLite + Upstash Redis REST + Caddy architecture.
