# Reviewer provisioning and plugin reuse

Assessment and implementation contract, 1 October 2026. The local provisioning foundation exists, but it does not enable plugins, create administrators, appoint reviewers or change infrastructure.

## Current boundary

Better Auth 1.7.6 manages credentials, verified email, database sessions and authenticator verification. Acticlaim records recent session-bound MFA assurance. Reviewer grants are expiring, revocable records with immutable attribution. TaskReviewService checks active accounts, grants, self-review restrictions and task terms, then records a decision and changes review state atomically. No review controller or reviewer provisioning command is exposed.

The raw Better Auth handler runs before Nest routing. Nest's AdminMfaRequired guard does not cover new Better Auth plugin endpoints automatically. Privileged plugin operations would need equivalent authentication, recent MFA, authorization, Origin checks and audit at the auth-handler boundary. Test those routes directly, not only a Nest wrapper.

## Reuse decision

| Requirement                                                 | Component                              | Decision                                                                                        |
| ----------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Authenticator enrollment and verification                   | Better Auth two-factor                 | Keep current integration; finish UI and recovery                                                |
| Generic user administration                                 | Better Auth Admin                      | Evaluate when needed; do not enable broad account controls for task reviewers                   |
| Invitations, team membership and roles                      | Better Auth Organization               | Preferred candidate for future team identity; map permissions and direct routes before adoption |
| Time-limited task-review authority with reasons and history | Acticlaim reviewer grants              | Preserve as authoritative domain permission                                                     |
| Funding protection, review decisions and self-review checks | Acticlaim transactions and constraints | Preserve; authentication roles cannot replace these                                             |

The Admin plugin offers role assignment and account-management operations, including impersonation. General roles alone do not satisfy Acticlaim's grant expiry, revocation attribution and immutable task-review history. Adding it requires integration around those policies. This is a scope decision, not a claim that the library cannot be extended.

Do not create two writable sources for review permission. A future account-management role must not implicitly grant task review, refunds, publication or permission provisioning. Keep impersonation disabled unless separately justified and audited; an impersonated session must never satisfy administrative or financial authorization.

## Provisioning foundation implemented locally

`apps/api/src/reviews/reviewer-provisioning.ts` contains the narrow grant/revoke service and `reviewer-provisioning-cli.ts` exposes it only as a bounded CLI. It requires a separately named provisioning database URL, an active verified operator account, a token whose SHA-256 hash is configured separately, a stable grant UUID, explicit reason and expiry. Grants are limited to 30 days by the current CLI policy, exact retries are idempotent, conflicting retries fail, and revocation is immutable.

This is not deployment authorization. The API role has not been proven unable to write grants, no operator token is configured, no hosted database was contacted and no real grant was created. Native PostgreSQL role-isolation and concurrent provisioning tests remain required before production use. The CLI now supports an explicit read-only preview mode; apply still requires the normal write path. It emits only operation and record identifiers; errors are deliberately generic.

## Provisioning contract and remaining deployment work

The local implementation follows this contract. Deployment still needs a separately authorized database principal, authenticated operator execution and external audit. Avoid a public permission-management API or a new generic role framework. Create no real grants during development.

1. Use a separately authorized database principal with scoped provisioning privileges. The API role must remain unable to insert/update grants. Do not default to the API database URL or require owner/superuser credentials.
2. Bind operator identity through protected configuration and the authenticated operator environment/database principal. A caller-supplied grantedBy UUID is audit data, not authority. Validate this binding before commands; document credential ownership and revocation.
3. Resolve a pre-existing verified active Acticlaim account by its unambiguous ID. Never auto-create accounts or verify email. Require reason, explicit expiry and stable grant UUID. Establish a documented duration bound before shipping.
4. Provide preview and explicit apply. Revalidate at apply time and transact. An exact grant UUID/payload retry returns the original; changed input fails. Do not silently extend grants or replace an unrevoked grant.
5. Revoke a specific grant with operator and reason. Exact revocation retries preserve the original audit; conflicting retries fail. Explicitly revoke expired grants before replacement. No delete, truncate or un-revoke command.
6. Initial appointment allows authenticator enrollment. A grant alone must never unlock review: future routes require recent MFA and commands recheck permission in their transaction. Bootstrap does not create a general permission-manager role.
7. Bound connection/statement time, close connections and sanitize failures. Output only necessary identifiers and outcomes. No credentials in command arguments, logs or Git.

An operator ID in configuration does not prove who ran a command. Deployment must restrict execution to authenticated operators, establish the principal/identity binding and retain an external execution audit. Keep provisioning unavailable until that boundary is established. Do not run the implementation against hosted data as part of development.

## Required verification

- Synthetic grant/revoke lifecycle, exact and conflicting retries, required reason/expiry and inactive/unverified targets.
- Missing/wrong operator binding, API-role write denial and provisioning-role privilege limits. Native PostgreSQL role tests are required; PGlite alone does not establish hosted-role isolation.
- Concurrent duplicate grants and revoke/review races; transaction-time expiry and revocation checks.
- Revoked/expired permission denied despite recent MFA, and current permission denied without recent MFA at the future HTTP boundary.
- Safe preview, rollback, bounded CLI failures and sanitized errors.

## Following slices

After provisioning code: enrollment/challenge UI, backup-code explanation and audited recovery. Recovery must define authorized operators, required evidence, session/assertion revocation, notification and audit retention. No routine unaudited SQL factor deletion. Then add scoped review reads and commands with derived actor IDs, Origin checks and idempotent decisions.

Do not onboard real reviewers before these flows work. Finish the funded individual-task journey before team participation and milestones. Deployment roles, real appointments, hosted migrations and actual provider delivery remain separate operations.

References checked with the installed package: [Better Auth Admin](https://www.better-auth.com/docs/plugins/admin), [Organization](https://www.better-auth.com/docs/plugins/organization), [2FA](https://www.better-auth.com/docs/plugins/2fa). Package upgrades require separate compatibility checks.
