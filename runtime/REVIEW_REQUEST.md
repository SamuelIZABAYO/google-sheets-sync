# Review Request — Task 7: Core Sync Logic - source_to_sheet (SQLite-adapted)

## What was built
Implemented the core sync executor for `source_to_sheet` and wired it into the Task 6 worker scaffold. The worker now executes real sync runs by reading from a SQLite source and writing rows to Google Sheets using stored encrypted OAuth tokens.

## PR
Pending (subagent flow commits/pushes branch directly)

## Files changed
- `apps/api/src/services/source-to-sheet-sync-executor.ts`: New core executor implementation
  - Loads sync job + Google token for user
  - Decrypts access token
  - Reads source rows from SQLite (`source.table` or fallback to `sourceSpreadsheetId`)
  - Applies `fieldMapping`
  - Clears/replaces or appends to Google Sheet via Sheets API
  - Returns run metrics/result payload
- `apps/api/src/app.ts`: Replaced placeholder executor wiring with `SourceToSheetSyncExecutor`
- `apps/api/src/services/sync-worker-pool.ts`: Hardened run lifecycle so executor exceptions mark run/job as failed (instead of leaving runs in `running`)
- `apps/api/test/sync-source-to-sheet-executor.test.ts`: New test validating SQLite source extraction + Google Sheets write request payload

## Security checklist
- [x] No hardcoded secrets
- [x] No injection vectors
- [x] Auth on all new endpoints
- [x] Input validated at boundary
- [x] Errors don't expose internals
- [x] Bcrypt used for any passwords
- [x] Dependency audit: PASSED

## Tests
- Unit: `apps/api/test/sync-source-to-sheet-executor.test.ts`
- Integration: existing sync worker/API tests unchanged and passing
- Type check: PASSED
- Test suite: PASSED

## Migration notes
- DB changes: None
- Breaking API changes: None

## Rollback
- How to undo: revert commit for Task 7 branch or reset to previous commit
- Data loss: NO

## Self-assessed risks
- Access token refresh flow is not yet implemented in executor (depends on future refresh-token handling path).
- Current source implementation supports SQLite (as required by architecture) and explicitly rejects non-SQLite source types.

## Task spec reference
Start Task 7: Core Sync Logic - source_to_sheet for Postgres (adapt for SQLite). Implement core sync logic to synchronize data from source databases to Google Sheets, replacing Task 6 placeholder executor and maintaining compatibility with Hetzner + SQLite + Upstash Redis REST + Caddy HTTPS architecture.
