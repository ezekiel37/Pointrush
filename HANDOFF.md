# PointRush handoff

Updated 1 October 2026. Read this before continuing, then verify git status and the remote develop head. This file records progress, not credentials or a deployed system.

## Working agreement

- Repository: ezekiel37/Pointrush. Continue on develop, with atomic feature commits and pushes; no new branches or CI workflows.
- Preserve existing working code and use relevant checks. Keep summaries concise to conserve the user's ChatGPT allowance.
- Never put tokens/secrets in chat or Git. Do not deploy, provision paid resources or send real provider messages without the necessary configuration and authorization.
- INFRASTRUCTURE.md owns hosting decisions; PRD, validation and testing-risk documents own product rules. This handoff does not override them.

## Architecture

Next.js/Vercel; NestJS/Cloud Run; Supabase Free PostgreSQL only; Drizzle/pg; Better Auth. Planned R2, Turnstile, PostgreSQL notifications and FCM. Existing Resend authentication delivery. Prefer recurring free allowances; Google trial credits are temporary. No Redis, microservices, queue server or additional database initially. Backups and restoration are required before real funds.

## Completed

- API/health/security foundation, portable PostgreSQL migrations and account/username lifecycle.
- Better Auth verification, sessions, recovery, authenticated onboarding and private account status.
- Encrypted durable auth-email queue, quotas, retry/lease fencing and finite delivery CLI.
- Next.js account/signup/login/reset/onboarding journeys and browser regression suite.
- Infrastructure decision docs: b25dfdf. Frontend foundation: 740e9e2.
- Current slice: separate API and worker environment parsing, shared origin validation, non-production loopback HTTP, production HTTPS, CLI execution deadline and regression tests. Migration configuration was already separate.

The API no longer needs RESEND_API_KEY. Worker needs its database settings, queue encryption key, Resend key and optional EMAIL_WORKER_MAX_DURATION_MS (default 60000). Deadline termination may leave a leased job/uncertain send; preserve its provider idempotency key during recovery. No schema changes in this slice.

## Verification

Current-slice checks: all 134 API tests passed, including process-level deadline termination against a stalled local database socket; repository lint and API production build passed. Formatting and diff checks are included before commit. Earlier frontend browser suite passed six scenarios; this slice does not change UI and that suite was not rerun. Native PostgreSQL multi-session tests, Docker smoke test, actual provider delivery and physical browser/domain checks remain unverified release gates. Tests use synthetic data and do not send real email.

## Next work

1. Design/implement authenticated scheduled execution appropriate to Cloud Run. Current runner is CLI-only; never embed its process-exit watchdog in the HTTP server. Inspect queue lifecycle before choosing HTTP runner versus managed job execution and compare scheduling costs.
2. Validate Cloudflare/Cloud Run ingress and trusted client-IP handling. Current auth intentionally uses the socket address; no broad trust-proxy setting should bypass this boundary.
3. Configure Supabase endpoints, runtime/migration roles, TLS, connection limits and backups when accounts/domain/billing are available. Validate native PostgreSQL and container operation.
4. Verify live signup/email/recovery on same-site production domains before public launch.
5. Next major product feature: sponsor funding ledger and task-allocation locks, followed by task review/participation/proof and rewards. Do not start external payments without idempotency, audit and reconciliation.

Remaining product modules include business/sponsor profiles, R2 evidence, notification preferences/device registrations/PWA, redemptions, offline codes, reputation/referrals, marketing/analytics, support/admin and full frontend journeys. Planned features are not implemented merely because they appear in the PRD.

## Constraints and outstanding gaps

- No infrastructure has been provisioned or deployed by the current work.
- Existing older CI workflow is stale; leave it untouched unless cleanup is explicitly requested.
- No real email credentials, database or payment setup is established here.
- Provider free quotas, scheduled-work costs and encrypted backup retention need deployment verification.
- Keep sponsor allocations locked and tasks reviewed before publication. Reputation is distinct from verification; sponsor ID and age requirements are deferred per product decisions.
- Update this file with each completed slice, including checks, blockers and the next concrete task. Git log is authoritative for final commit IDs.
