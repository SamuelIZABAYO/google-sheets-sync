# Review Request — Task 3: Google OAuth2 Integration (Endpoints, Token Encryption)

## What was built
Implemented Google OAuth2 login flow with secure state handling and callback exchange endpoints. Added encrypted token-at-rest storage for Google access/refresh tokens, with SQLite persistence and optional Upstash Redis REST support for OAuth state TTL storage. Updated user model/repository to support Google-linked users and preserved existing local email/password auth.

## PR
Pending push

## Files changed
- `apps/api/src/config/env.ts`: Added required Google OAuth and token encryption env vars; redirect URI helper for HTTPS + Caddy deployments.
- `apps/api/src/routes/auth.ts`: Added `/auth/google/start` and `/auth/google/callback` endpoints; integrated OAuth state validation and encrypted token persistence.
- `apps/api/src/services/google-oauth-service.ts`: Added Google auth URL generation, token exchange, and userinfo fetch logic.
- `apps/api/src/services/token-crypto.ts`: Added AES-256-GCM encryption/decryption utility for token storage.
- `apps/api/src/services/upstash-redis-client.ts`: Added Upstash Redis REST client (SETEX/GET/DEL).
- `apps/api/src/services/oauth-state-store.ts`: Added OAuth state abstraction with Upstash-first, SQLite fallback behavior.
- `apps/api/src/db/sqlite.ts`: Extended schema for OAuth state and Google token tables; user table support for provider/google sub.
- `apps/api/src/db/user-repository.ts`: Added local/google user creation and google account linking methods.
- `apps/api/src/db/oauth-state-repository.ts`: Added SQLite-backed OAuth state CRUD.
- `apps/api/src/db/google-token-repository.ts`: Added encrypted Google token upsert/read access.
- `apps/api/src/models/user.ts`: Added `authProvider` and `googleSub` support in user domain model.
- `apps/api/src/services/auth-service.ts`: Updated local auth logic for mixed provider support.
- `apps/api/test/auth.test.ts`: Added Google OAuth start and callback invalid-state coverage; updated schema/required env.
- `apps/api/test/token-crypto.test.ts`: Added unit test for encryption/decryption roundtrip.
- `.env.example`: Added Google OAuth and token encryption variables.
- `README.md`: Documented new OAuth endpoints, encryption behavior, and Caddy HTTPS callback default.

## Security checklist
- [x] No hardcoded secrets
- [x] No injection vectors
- [x] Auth on all new endpoints
- [x] Input validated at boundary
- [x] Errors don't expose internals
- [x] Bcrypt used for any passwords
- [x] Dependency audit: PASSED

## Tests
- Unit: `apps/api/test/token-crypto.test.ts`
- Integration: `apps/api/test/auth.test.ts`, `apps/api/test/health.test.ts`
- Manual steps:
  1. Set `.env` with Google OAuth credentials and `TOKEN_ENCRYPTION_KEY`.
  2. Call `GET /auth/google/start` and open `authorizationUrl`.
  3. Complete Google consent and verify callback returns app JWT + user profile.
  4. Verify encrypted token rows in `google_oauth_tokens` (not plaintext).
- Type check: PASSED
- Test suite: PASSED

## Migration notes
- DB changes: Added `oauth_states` and `google_oauth_tokens`; extended `users` with `auth_provider` and `google_sub`.
- Breaking API changes: None

## Rollback
- How to undo: Revert this branch commit(s) and redeploy previous image.
- Data loss: NO

## Self-assessed risks
- Google callback happy-path exchange is not yet fully integration-tested against live Google credentials in CI.
- Existing deployments with older SQLite schemas should be validated once with real persisted DB files to confirm ALTER behavior in all environments.

## Task spec reference
Begin work on Task 3: Google OAuth2 Integration (Endpoints, Token Encryption) for Google Sheets Sync-as-a-Service. Implement OAuth2 authentication flow with Google APIs, including token management and secure storage of refresh/access tokens with encryption. Adapt integration to SQLite backend, Upstash Redis REST API support, deployment on Hetzner, and HTTPS with Caddy.
