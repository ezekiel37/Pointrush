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
- Explicit no-trust proxy policy, missing transport identity rejection and INGRESS.md deployment gates (1167488).
- Internal sponsor funding ledger and task-allocation lock primitives, migration 0007 (4569fad).
- Authenticated sponsor profile ownership and atomic funded task creation, migration 0008 (3a8fa60); selected assignments and capped fixed rewards only.
- Internal task review, expiring reviewer permission grants, immutable decision audit and version/state checks, migration 0009 (2397614). Reviews do not publish tasks or release funding; there are no default grants.
- Current slice: reviewer-only authenticator enrollment, session-bound 15-minute admin MFA assurance, replay protection and an opt-in protected-route guard, migration 0010. See ADMIN_MFA.md. Backup-code login does not grant admin assurance. Admin review routes and MFA frontend journeys now exist; see the current local continuation below.
- Current local slice: bounded reviewer grant/revoke service and CLI with verified operator binding, 30-day maximum CLI grants, stable retry IDs and immutable revocation. See ADMIN_ACCESS_PLAN.md. No operator secret, real grant or hosted database was used.
- Current web slice: `/two-factor` MFA enrollment/challenge journey, Better Auth client integration, setup-link copy, in-memory backup-code display and backup-code warning. No MFA secret is persisted in browser storage. Browser E2E could not run because the Playwright Chromium executable is unavailable in this workspace.

The API no longer needs RESEND_API_KEY. Worker needs its database settings, queue encryption key, Resend key and optional EMAIL_WORKER_MAX_DURATION_MS (default 60000). Deadline termination may leave a leased job/uncertain send; preserve its provider idempotency key during recovery. This slice adds migration 0010; it has not been applied to a hosted database. AUTH_SECRET also encrypts MFA factor material; protect and back it up. SPONSOR_TERMS_VERSION must remain unset until real sponsor terms are published and shown for acceptance.

## Verification

Current-slice checks: all 170 API tests passed; web typecheck, unit tests and production build passed. API MFA integration exercises real Better Auth enrollment, login, step-up, replay rejection, backup-code restrictions, guard enforcement, expiry and logout with synthetic data. Provisioning tests cover token binding, active/verified identities, duration bounds, exact retries, conflicting retries, read-only preview and immutable revocation. Static UI audit has no findings. Native PostgreSQL role-isolation, competing-reviewer, duplicate-task and concurrent-allocation checks are included or required but not run (no native PostgreSQL/Docker available). Browser E2E was attempted but could not launch because the required Playwright Chromium executable is missing. Actual provider delivery, container operation and physical browser/domain checks remain release gates.

## Next work

Admin inspection is recorded in ADMIN_ACCESS_PLAN.md: preserve the domain reviewer grants; do not enable the broad Admin plugin solely for reviewer provisioning. The local grant/revoke foundation exists; next deployment work is authenticated operator execution, separate database-role verification and native concurrency tests. Raw Better Auth routes require their own MFA/authorization enforcement; Nest guards do not protect them. This tool is not configured or deployed.

October 1 product update: optional tasker teams, project-specific leadership, accepted reward shares, reputation safeguards and revenue priorities are documented in TEAMS_AND_REVENUE.md and linked from the PRD/rules. Planned only: no team routes, milestone settlement, team wallet or cash withdrawals have been added. The 8% fee remains illustrative. Complete the core paid-work journey before team collaboration. Documentation-only checks use formatting, internal-link validation and diff inspection; the 165-test result above belongs to the preceding MFA implementation.

Next code slice: audited MFA recovery and session-management journeys, followed by protected review reads/commands. The internal review command intentionally has no HTTP module/controller. Do not enroll real reviewers before recovery, notification and deployment identity controls exist: factor disabling is currently blocked. Do not substitute a client boolean or sponsor badge for MFA/permission. Follow with versioned task amendments and paginated sponsor listings. Business teams and frontend sponsor forms remain to be built. Keep confirmed-funding commands internal. Items 1-4 below are deployment release gates.

1. Review deployment configuration for the new `email:serve` entry point: separate secret, restricted invocation, scheduler pricing/configuration, service timeouts and queue monitoring. See EMAIL_QUEUE.md. Code is ready for local verification; no scheduler or service is deployed. Do not provision resources without authorization/configuration.
2. Execute INGRESS.md staging checks when a deployment exists. Current auth intentionally uses the socket address; proxy-derived visitor identity remains unverified. Do not invent hop counts or trust Cloudflare headers on a publicly bypassable origin.
3. Configure Supabase endpoints, runtime/migration roles, TLS, connection limits and backups when accounts/domain/billing are available. Validate native PostgreSQL and container operation.
4. Verify live signup/email/recovery on same-site production domains before public launch.
5. Continue protected admin review access, participation/proof and rewards. Sponsor owner authorization, atomic task binding, internal audited decisions and backend MFA assurance exist; business delegation, MFA frontend/recovery, HTTP review and publication do not. Do not start external payments without verified event ingestion and reconciliation.

Remaining product modules include business/sponsor profiles, R2 evidence, notification preferences/device registrations/PWA, redemptions, offline codes, reputation/referrals, marketing/analytics, support/admin and full frontend journeys. Planned features are not implemented merely because they appear in the PRD.

## Constraints and outstanding gaps

- No infrastructure has been provisioned or deployed by the current work.
- Existing older CI workflow is stale; leave it untouched unless cleanup is explicitly requested.
- No real email credentials, database or payment setup is established here.
- Provider free quotas, scheduled-work costs and encrypted backup retention need deployment verification.
- Keep sponsor allocations locked and tasks reviewed before publication. Reputation is distinct from verification; sponsor ID and age requirements are deferred per product decisions.
- Update this file with each completed slice, including checks, blockers and the next concrete task. Git log is authoritative for final commit IDs.

## Local continuation: review HTTP verification (1 October 2026)

Local commits f90ba4f, f57e607 and 03cb14b added operator MFA recovery, session-management API controls and review routes. They did not complete the participant workflow. This continuation fixes review money serialization, removes duplicated read projections, adds bounded cursor pagination and explicitly tests ReviewsModule through HTTP using real Better Auth sessions. Tests previously omitted that module because their AppModule database configuration was undefined.

Next: implement reviewed participation and settlement terms, then publication, commitments, proof, correction/appeals and exactly-once reward backing. The PRD leaves numerical dispute timings and conversion/settlement decisions as release gates. Do not make publication-time terms bypass review; legacy task records without terms remain not_live. Do not describe sponsor reward backing as a cash payout or enable sponsor refunds on proof rejection.

Remaining debt from the prior batch: migration 0011 lacks its Drizzle snapshot; recovery needs stronger concurrency/rollback/immutable-history verification; session controls have no frontend yet. Full repository lint also reports an unescaped apostrophe in the existing two-factor UI. Native PostgreSQL concurrency and browser E2E remain unverified. No hosted database, provider or infrastructure changes were made.

## Funded-task backend continuation (1 October 2026)

See TASK_WORKFLOW.md for migrations 0012–0013 and current API contracts. Backend now supports reviewed explicit workTerms, capped-fixed publication, capacity claims, text proof/correction, sponsor decisions, decision receipts, independent appeal decisions and atomic exactly-once reward backing. Task creation/review reads include the terms. Legacy records without terms cannot publish; selected assignments remain unsupported by participation routes. Migrations include updated Drizzle snapshots covering the earlier recovery table without rerunning its DDL.

This materially advances item 4 but does not complete its usable frontend journey. No points conversion, real payouts, refunds, file uploads or hosted migrations occurred. Overdue queues, notification delivery, operational appeal grant provisioning, UI integration and native PostgreSQL race verification remain. Do not report backend reward backing as redeemed points or cash payment. Preserve rejected/disputed backing until an explicit settlement release workflow is authorized.

Verification for this continuation: 179 API tests passed with migrations 0012–0013, API typecheck/build passed, scoped API lint and touched-file formatting passed. Native database race tests and browser UI were not run. Commit contains local code/docs only and has not been pushed.

## Discovery and return visits (2 October 2026)

Added a separate task-query service/controller for published task title search, personal claims, owned sponsor tasks and owner-only participant lists. Pages default to 25 and cap at 50, use UUID cursors and reject editable ownership fields. Personal claims include latest proof reference and exact approved backing; discovery excludes unpublished, ended and inactive-sponsor tasks. See TASK_WORKFLOW.md for contracts. Next integration work remains the sponsor/tasker screens, notifications and operational review queues; these APIs make those screens navigable without manually entering record IDs.

Verification: 180 API tests passed, including HTTP list routing/authentication and service ownership/pagination checks. API build, scoped lint and formatting passed. No migration, infrastructure change, branch, workflow or remote push was introduced in this slice.

## Task frontend: discovery, joining and return visits (2 October 2026)

Implemented `/tasks`, `/tasks/[id]` and `/my-tasks` against the existing cookie-authenticated task APIs and configurable NEXT_PUBLIC_API_ORIGIN. Search is URL-backed with debounce/IME support and resets pagination. Reads cancel stale requests, time out, revalidate on reconnect/visibility and discard private data on failure. Briefs expose reviewed conditions before joining; concurrent clicks are locked and join retries rely on backend idempotency. Reward values use exact bigint formatting, explicit WAT dates and no claim of cash withdrawal or redeemable points. Account/help copy and shared UI ownership are updated.

Verification: full `npm run check` passed (formatting, lint, typechecks, 180 API tests, 5 web tests and production builds). Strict premium UI audit reports zero findings. Three new browser scenarios cover mobile search, join locks and session expiry, but all browser tests were blocked before execution by missing Chromium; attempted installation failed with an invalid downloaded archive. No visual/browser acceptance is claimed. Existing auth/recovery formatting and MFA JSX apostrophe were corrected to unblock the repository checks.

Next: participant claim/proof submission UI, explicit decision acknowledgement, correction and appeal flows; then sponsor decisions and independent appeal review screens. Item 4 is still incomplete. My tasks intentionally discloses missing proof submission UI. Native PostgreSQL concurrency verification and actual browser verification remain pending. Work is local only; no branch, workflow, infrastructure, hosted migration or real provider action was introduced.

## Participant proof, correction and appeal UI (3 October 2026)

Added `/my-tasks/[id]`: immutable task brief, text evidence and decision history, explicit receipt acknowledgement, one correction and rejection appeal. My tasks opens the participant claim. The protected read includes a participant flag and server-observed timestamp so UI deadlines do not trust the device clock. Actual writes remain subject to database constraints and session authorization. Drafts remain in component memory through status refreshes. Uncertain writes freeze the payload and retain the UUID for explicit retry; no automatic retry or receipt occurs. Shared EvidenceForm owns labelled validation and expandable text entry. No uploads, payments, migrations or provider calls were added.

Verification: formatting, lint, typechecks, 180 API tests and 10 web tests passed when rerun with loopback access. Five new unit cases cover initial expiry, receipt gating, correction boundaries, appeal limits and revision ordering; the existing workflow integration test now verifies the protected brief/participant context. Two browser scenarios were added for dropped-response retries and explicit acknowledgement; browser execution remains blocked by missing Chromium. Default Turbopack production compilation encounters an environment port-binding restriction; the supported webpack production build passed. The strict UI audit has zero findings. Native PostgreSQL races and real browser/mobile verification remain outstanding.

Next: sponsor proof-decision screens and independent appeal-review screens. The backend supports these commands but their UI remains incomplete. Persistent drafts are not implemented: closing the tab or browser history navigation may discard text. Ordinary in-app link navigation offers a discard warning, and unload uses the browser's unsaved-work warning. This continuation is local until explicitly reported as published.

## Sponsor decisions and independent appeals (3 October 2026)

Implemented sponsor task/participant lists and proof-decision screens, plus independent pending-appeal list/detail/resolution screens. Reused existing commands and authorization. Added the bounded GET work/appeals projection requiring appeal grant and recent MFA; excludes self-involvement and resolved cases. Appeal detail includes the recorded resolution. Decisions require a reason and explicit consequence confirmation; uncertain retries retain the same UUID/body. Shared DraftGuard replaces the participant-specific navigation warning and serves reviewer drafts too. No branches, CI, migrations, infrastructure or external providers were added.

Verification: formatting/lint/typechecks, 180 API tests and 10 web tests passed. After strengthening queue HTTP coverage, the 17 relevant HTTP/workflow tests passed again. Tests cover valid/absent/revoked appeal grants, self-involvement exclusions, bounded queries, resolved removal, and expired MFA. API production build and Next webpack production build passed; default Turbopack is blocked by the environment's port-binding restriction. Static UI audit reports zero findings. Browser tests were attempted but Chromium is missing; new scenarios are authored, not browser-verified.

Next: sponsor registration/task creation and publication screens, platform task review UI, evidence uploads, notifications and controlled appeal-reviewer provisioning. No live reviewer permission or real money action occurred. This feature is committed locally until a subsequent publication is explicitly reported.
