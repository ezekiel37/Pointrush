# Admin session assurance

Backend foundation only. Migration 0010 adds Better Auth authenticator factors and server-side MFA assertions. No admin review routes, real reviewer appointments or deployment are included. Do not onboard real reviewers until enrollment/challenge UI and controlled recovery are ready.

## Authentication and authorization

Only a verified, active account with a current reviewer grant can start enrollment. Better Auth requires the password and a successful six-digit authenticator code before enabling the factor. Seeds and backup codes are encrypted with AUTH_SECRET; protect that key and plan recovery/rotation with database backups. No new service or environment variable is required.

After genuine TOTP verification, the application records an assertion tied to the actual current session and verified factor. Enrollment rotates the session; pending two-factor login records the newly created session. `AdminMfaRequired` makes SessionGuard require this assertion, an unexpired session, an enabled verified factor and verification within the preceding 15 minutes. Logout/session deletion removes its assertion. An enabled-MFA flag alone is insufficient.

The decorator does not grant reviewer permission. Future controllers must derive the actor from authentication; TaskReviewService separately checks active account, current grant, task ownership restrictions and audit requirements. Never accept an admin/MFA flag or reviewer ID from the client.

## Replay and recovery policy

Successful authenticator codes are recorded as keyed hashes, not plaintext. A factor lock serializes assertion creation; reuse within two minutes fails without creating another assertion. Expired code hashes are removed when that factor is next verified. Record creation is awaited and transactional, never fire-and-forget. Better Auth's database-backed endpoint limits and login challenge lockouts remain enabled; deployed visitor identity must satisfy INGRESS.md.

Remember-device requests are disabled. Backup-code login remains available for ordinary account recovery but does not grant admin assurance; an authenticator step-up is still required. Reading the enrollment URI again or regenerating backups requires recent MFA as well as Better Auth's password checks. Factor disabling is blocked until a separately authorized, audited recovery process exists. Losing the authenticator therefore blocks administrative actions even with a backup code; the recovery workflow is a release gate, not a manual database shortcut.

## Verification and limitations

The integration test uses the actual Better Auth HTTP handler and a migrated local PGlite database: unauthorized enrollment, wrong codes, encrypted factor data, rotated sessions, duplicate codes, rejected device trust/disable, backup login without admin assurance, successful authenticator login and step-up, expiry, protected guard denial and logout cleanup. All identities and messages are synthetic.

Native PostgreSQL concurrency, production proxy limits, reviewer UI, controlled permission provisioning, audited factor recovery and deployment remain outstanding. No production controller is decorated yet: the internal review service remains inaccessible over HTTP until these access flows are completed. See TASK_REVIEW.md and AUTH.md.

Provider reference: https://www.better-auth.com/docs/plugins/2fa (implementation checked against installed Better Auth 1.7.6).
