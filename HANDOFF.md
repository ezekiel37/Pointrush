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
- Separate API/worker environment parsing, origin validation and CLI execution deadline.
- Authenticated email HTTP runner, bounded batches, overlap protection and cooperative delivery cancellation (c71fe44).
- Current slice: explicit no-trust proxy policy, rejection of missing transport identity, expanded spoofing/rate-limit tests and INGRESS.md deployment decision record. No proxy header is newly trusted; cloud identity verification remains a release gate.

The API no longer needs RESEND_API_KEY. Worker needs its database settings, queue encryption key, Resend key and optional EMAIL_WORKER_MAX_DURATION_MS (default 60000). Deadline termination may leave a leased job/uncertain send; preserve its provider idempotency key during recovery. No schema changes in this slice.

## Verification

Current-slice checks: all 140 API tests, lint, production build, formatting and diff checks passed. Added Cloudflare-header session coverage, rotating-header rate-limit attempts and missing transport identity checks. Earlier frontend browser suite passed six scenarios; this slice does not change UI and that suite was not rerun. Native PostgreSQL multi-session tests, Docker smoke test, actual provider delivery and physical browser/domain checks remain unverified release gates. Tests use synthetic data and do not send real email.

## Next work

Next code slice: inspect PRD funding rules and implement the sponsor ledger and task-allocation locks. Items 1-4 below are deployment release gates; do not stall product work by guessing unavailable cloud configuration.

1. Review deployment configuration for the new `email:serve` entry point: separate secret, restricted invocation, scheduler pricing/configuration, service timeouts and queue monitoring. See EMAIL_QUEUE.md. Code is ready for local verification; no scheduler or service is deployed. Do not provision resources without authorization/configuration.
2. Execute INGRESS.md staging checks when a deployment exists. Current auth intentionally uses the socket address; proxy-derived visitor identity remains unverified. Do not invent hop counts or trust Cloudflare headers on a publicly bypassable origin.
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
