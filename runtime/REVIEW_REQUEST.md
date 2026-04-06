# Review Request — Task 3: Add CSV/Excel Source Support

## What was built
Added file-source support for sync jobs to import rows from CSV and Excel files, mapped through existing fieldMapping and written to Google Sheets through the existing sync executor flow. Added validation for source type/config and file readability.

## PR
N/A (subagent branch push only)

## Files changed
- apps/api/src/services/source-to-sheet-sync-executor.ts: added `source.type` support for `csv`/`excel`, file validation, CSV parsing, Excel worksheet parsing, row normalization/validation.
- apps/api/test/sync-source-to-sheet-executor.test.ts: added integration tests for CSV and Excel sources and missing-file validation.
- apps/api/package.json: added `csv-parse` and `exceljs` dependencies.
- package-lock.json: lockfile updates for new dependencies.

## Security checklist
- [x] No hardcoded secrets
- [x] No injection vectors
- [x] Auth on all new endpoints
- [x] Input validated at boundary
- [x] Errors don't expose internals
- [x] Bcrypt used for any passwords
- [x] Dependency audit: PASSED

## Tests
- Unit: None — behavior covered in executor integration tests.
- Integration: `apps/api/test/sync-source-to-sheet-executor.test.ts`
- Manual steps:
  1. Create a sync job with `destinationConfig.source.type = "csv"` and `filePath` to a CSV file with headers.
  2. Run sync job and verify mapped rows are written to destination Google Sheet.
  3. Create a sync job with `destinationConfig.source.type = "excel"`, `filePath`, and optional `worksheetName`.
  4. Run sync job and verify mapped rows are written to destination Google Sheet.
- Type check: PASSED
- Test suite: PASSED

## Migration notes
- DB changes: None
- Breaking API changes: None

## Rollback
- How to undo: revert this branch commit.
- Data loss: NO

## Self-assessed risks
- Large local files may increase memory pressure during parse.
- CSV parsing assumes standard delimiter/header structure.

## Task spec reference
Start Task 3: Add CSV/Excel file import support to sync jobs so they can read and import data from CSV/Excel sources with validation, aligned to existing sync job flow.
