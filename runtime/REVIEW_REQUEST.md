# Review Request — Task 5: CRUD API for Sync Jobs

## What was built
Implemented authenticated, user-scoped CRUD REST endpoints for sync jobs (`GET /sync-jobs`, `POST /sync-jobs`, `PATCH /sync-jobs/:id`, `DELETE /sync-jobs/:id`) with strict request validation, service-layer business logic, and SQLite-backed repository updates.

## PR
Pending push/PR creation.

## Files changed
- `apps/api/src/auth/require-auth.ts`: Added reusable Bearer token auth pre-handler.
- `apps/api/src/types.ts`: Extended Fastify request typing with `authUser`.
- `apps/api/src/services/sync-job-service.ts`: Added sync job business logic + not-found domain error.
- `apps/api/src/db/sync-job-repository.ts`: Added update/delete data access methods with user scoping.
- `apps/api/src/routes/sync-jobs.ts`: Added authenticated CRUD endpoints with Zod validation and error mapping.
- `apps/api/src/app.ts`: Registered sync job routes.
- `apps/api/test/sync-jobs-api.test.ts`: Added integration tests for happy path, invalid input, and missing auth.

## Security checklist
- [x] No hardcoded secrets
- [x] No injection vectors
- [x] Auth on all new endpoints
- [x] Input validated at boundary
- [x] Errors don't expose internals
- [x] Bcrypt used for any passwords
- [x] Dependency audit: PASSED

## Tests
- Unit: None — repository/service behavior covered in integration-style route tests and existing repository tests
- Integration:
  - `apps/api/test/sync-jobs-api.test.ts`
  - `apps/api/test/sync-models.test.ts` (existing)
- Manual steps:
  1. Register/login and capture bearer token.
  2. `POST /sync-jobs` with valid body → `201` + created job.
  3. `GET /sync-jobs` → only caller’s jobs.
  4. `PATCH /sync-jobs/:id` as owner → `200`; as another user → `404`.
  5. `DELETE /sync-jobs/:id` as owner → `204`; as another user → `404`.
- Type check: PASSED
- Test suite: PASSED

## Migration notes
- DB changes: None
- Breaking API changes: None

## Rollback
- How to undo: Revert commit for Task 5 branch and redeploy previous image.
- Data loss: NO

## Self-assessed risks
- API currently returns JSON configuration fields as serialized JSON strings from DB model; consumer parsing is required client-side.

## Task spec reference
Start Task 5: CRUD API for Sync Jobs. Implement authenticated and user-scoped REST endpoints (GET, POST, PATCH, DELETE) for managing sync jobs with SQLite backend and architecture compliance.
