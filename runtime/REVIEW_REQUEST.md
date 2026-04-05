# Review Request — Task 9: Frontend Dashboard Shell & Authentication

## What was built
Implemented a new React + Vite frontend app (`apps/web`) with a protected dashboard shell and JWT login flow wired to backend auth endpoints (`/auth/login`, `/auth/me`). Added Docker/Caddy routing so Hetzner deployment serves the SPA over HTTPS while forwarding API routes to the Fastify backend and preserving Upstash Redis-backed backend architecture.

## PR
TBD (will be filled after PR creation)

## Files changed
- `apps/web/*`: new frontend app (routing, auth context, login page, protected dashboard shell, tests, Vite config, Dockerfile, nginx config)
- `package.json`: root workspace scripts updated to include frontend build/test/typecheck and `dev:web`
- `package-lock.json`: dependency lock updates for frontend workspace
- `.env.example`: added `VITE_API_BASE_URL`
- `Caddyfile`: split routing (API paths to `api`, all other paths to `web`)
- `docker-compose.yml`: added `web` service and caddy dependency wiring
- `README.md`: documented frontend app and task 9 architecture updates

## Security checklist
- [x] No hardcoded secrets
- [x] No injection vectors
- [x] Auth on all new endpoints
- [x] Input validated at boundary
- [x] Errors don't expose internals
- [x] Bcrypt used for any passwords
- [x] Dependency audit: PASSED (`npm audit --audit-level=high`)

## Tests
- Unit: `apps/web/src/test/api.test.ts`
- Integration: `apps/web/src/test/auth-context.test.tsx`
- Type check: PASSED (`npm run typecheck`)
- Test suite: PASSED (`npm run test`)

## Migration notes
- DB changes: None
- Breaking API changes: None

## Rollback
- How to undo: revert merge commit for Task 9, then redeploy containers
- Data loss: NO

## Self-assessed risks
- Caddy API route matcher currently targets known backend paths (`/auth*`, `/sync-jobs*`, `/health*`, `/webhooks*`); if new backend route prefixes are introduced later, Caddy routes should be expanded accordingly.

## Task spec reference
Start Task 9: Frontend Dashboard Shell & Authentication. Build initial React + Vite frontend shell for the web app, including login flow integrated with backend JWT authentication. Align with Hetzner + Caddy HTTPS + Upstash Redis REST-backed backend architecture.
