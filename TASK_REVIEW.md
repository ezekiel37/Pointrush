# Task review and reviewer permissions

Migration 0009 adds the review command and audit records. Protected admin HTTP routes now expose review reads and decisions. No admin UI or default administrator is created; migrations do not appoint reviewers.

## Permission boundary

See ADMIN_ACCESS_PLAN.md for the plugin comparison and next provisioning-tool contract. Better Auth's raw endpoints bypass Nest guards; an admin plugin does not automatically inherit PointRush's recent-MFA or reviewer checks.

`task_reviewer_grants` grants only the ability to review tasks. It does not grant funding, refunds, publication, user suspension or permission management. Grants identify the reviewer, granting operator, reason, creation time and required expiry. One unrevoked grant per reviewer is allowed; explicitly revoke an expired grant before renewal. Revocation records its operator, reason and time. Grant content cannot be silently edited, extended, deleted or unrevoked.

Grant provisioning is available through the separate operator CLI described in ADMIN_ACCESS_PLAN.md. A database operator can insert rows, so deployments must give the application runtime SELECT access only on this permission table, with grant/revoke writes reserved for a separately authorized administrative identity. This is a required deployment privilege boundary, not a claim that SQL rows authorize their own creator. Do not run production with database-owner credentials. Synthetic grants in tests are not real administrative appointments.

Before exposing `TaskReviewService.decide`, the admin boundary must authenticate a real recent MFA session, derive the reviewer account ID, enforce Origin protection and restrict review/audit reads. Never accept an actor ID, admin flag, permission flag or `mfaVerified` boolean from request bodies. This service is an internal authorization/persistence capability; it cannot prove MFA on its own. Identity verification badges, sponsor payments and reputation never grant review permission.

## Decision contract

The internal command takes a stable request UUID, task UUID, expected terms version, expected stored terms hash, decision, checklist and reason. The reviewer ID comes separately from the trusted caller. Current tasks have immutable version 1; future amendments must create/version terms and require another review. The stored hash is the normalized creation fingerprint, not an external verification signature.

Decisions are `approved`, `changes_required` or `rejected`. Every decision records an immutable audit row with the grant used. The checklist explicitly covers permitted objective, clear instructions, feasible proof, fair reward terms and safe destinations. All five must be true for approval. A checklist is a human review attestation; this code does not automatically verify URLs, evidence or business legitimacy. Reviewers must explain corrections/rejections in the reason.

An active account and unexpired, unrevoked grant are required. A sponsor cannot review its own task. Only the current pending version may be decided. Stale versions/hashes and changed content under an existing request ID fail; an identical retry by a currently authorized reviewer returns the original audit record. Revoked/expired permissions cannot read that record through a retry. Only one decision may exist per task version, even from different reviewers.

## Atomic state and financial protection

The service locks reviewer account, permission grant and task in that order. Database triggers independently recheck permission, self-review, version, state and approval backing. The audit insertion and review-state transition commit together. Task fields remain immutable; direct review-state changes without matching audit evidence are rejected. Review and permission history cannot be truncated. Permissions can expire while a command waits; the database rechecks expiration at insertion.

Approval changes only `reviewState`. It never makes a task live, creates participation commitments or pays rewards. Publication must later recheck active sponsor access, current approval, dates, funding and complete participation/correction/appeal terms. Rejection and changes-required retain the full funding lock; neither creates an automatic refund. Amendments, appeals, cancellation and release remain separate unimplemented workflows. Current changes-required tasks cannot yet be edited/resubmitted.

All decisions, including a first approval, can be rolled back if the outer business transaction fails. Retries retain their original request identity. Historical audit records preserve the permission grant even after it expires or is revoked. Keep custom migration triggers alongside Drizzle snapshots; snapshots alone do not describe trigger behaviour.

## Verification and next work

Local PGlite tests exercise valid decisions, duplicate requests, stale versions, conflicting retries, self-review, unavailable permissions, incomplete checklists, funds retention, direct database bypass attempts and audit/transition rollback. The checked-in native PostgreSQL suite now races two independent reviewers on one task and requires exactly one decision. Native concurrency has not been run here; PGlite results do not establish that guarantee in deployed PostgreSQL.

Backend MFA/session assurance now exists; see ADMIN_MFA.md. Next: controlled permission provisioning and MFA enrollment/challenge/recovery journeys, then protected review reads/commands and versioned task amendments. Do not attach an admin controller to the internal service until that boundary is complete. No hosted migration, real permission grant, deployment or payment was performed.

## Current HTTP contract

All routes require a verified authenticated identity, active linked account, recent session-bound authenticator assurance and an unexpired, unrevoked reviewer grant. Mutation requests also require the trusted Origin. Caller identities are derived from the session.

- GET `/api/v1/admin/reviews/tasks?limit=25&after=UUID`: returns `{items, nextCursor}`. Maximum page size is 50; cursor ordering is by task UUID, not creation time. Refresh from the first page to discover new work; the queue is not a stable snapshot during concurrent changes.
- GET `/api/v1/admin/reviews/tasks/:taskId`: pending task detail with integer decimal strings for monetary values, including values beyond JavaScript's safe integer range.
- POST `/api/v1/admin/reviews/tasks/:taskId/decision`: request UUID, expected version/hash, decision, checklist and reason. A body taskId is rejected. The route identifies the task and the session identifies the reviewer. Existing transactional grant and self-review checks apply.

HTTP regression tests now mount ReviewsModule explicitly alongside the real authentication and session guard. They cover unauthenticated reads, missing/expired assurance, missing grants, Origin protection, malformed pagination, funded-task JSON serialization and self-review denial. Synthetic assurance rows isolate this boundary; actual TOTP verification is tested separately in admin-mfa.test.ts.

Publication remains unavailable. The task model has no structured correction/appeal deadlines or settlement terms yet. Those terms must be captured before review and protected for existing participants; adding them only when publishing would bypass review. Approved tasks cannot be silently amended to add these fields. The next workflow slice must account for legacy tasks without the new terms.
