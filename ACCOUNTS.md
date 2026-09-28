# Account Management

Account creation and username changes are implemented internally. Verified-email authentication now supports authenticated onboarding and private account-status reads; see [authentication](AUTH.md). Profile editing and username availability are not exposed. Business permissions and endpoint abuse limits remain release requirements.

## Private Account Status

`GET /api/v1/accounts/me` requires a valid, verified-email session and returns `Cache-Control: no-store`. It resolves the account solely through the server-side authentication link. Query parameters and headers cannot select another account.

- Before onboarding: `{ "onboarding": "required", "account": null }`. Reading never creates an account.
- After onboarding: `{ "onboarding": "complete", "account": { "id": "…", "username": "…", "displayName": "…", "accessState": "active" } }`. Access state may also be `restricted`, `suspended` or `closed`.
- A linked account missing its profile or current username returns a safe 500, not an invitation to onboard again.

This read remains available for restricted, suspended and closed accounts with valid verified sessions so the client can explain their status. Its method-scoped guard exception permits only GET/HEAD and does not grant business access. Other routes retain their existing default-deny guard. Expired/revoked sessions still receive 401; unverified identities receive 403. The response contains no credentials, email, phone, moderation evidence, roles or invented balances. UI routing must not treat completed onboarding as authorization.

Real HTTP tests cover onboarding state, all access states, two-user isolation, spoofed identifiers, verification changes, signout and incomplete records. Endpoint-specific read throttling and scoped support access remain future release work.

## Boundaries

`AccountsModule` exports `AccountsService`. The service validates input and delegates persistence to `AccountsRepository`. Only the repository accesses account tables. `DatabaseModule` is registered once at the application root and shares its pool through Nest dependency injection.

- Creation accepts only `username` and `displayName`. Caller-supplied IDs, roles, verification flags, status and timestamps are rejected.
- Creation atomically inserts an account, profile and current username. Duplicate or reserved names roll back all three writes. No verified contact, badge, role, points or sponsor approval is granted.
- Rename takes an account ID from a trusted internal caller and a strict username payload. The future controller must derive that ID from the authenticated session, not trust a request-body ID.
- Renames currently require an active account. Restricted/suspended/closed accounts cannot rename through this internal command. Replace this conservative gate with explicit scoped permissions when the restriction engine is implemented; it must not become a blanket denial of support or history access.
- No public account lookup, directory or availability endpoint exists yet. Do not expose repository methods directly through generic CRUD routes.

## Names

Usernames accept outer whitespace and ASCII upper/lowercase input, then store lowercase. Validate ASCII before case conversion so a Unicode lookalike cannot become a valid ASCII identifier. Canonical length is 3-20 characters, beginning with a letter, ending alphanumeric, without consecutive underscores. Database uniqueness includes platform-reserved and retired names.

Display names trim outer whitespace and preserve internal spacing, apostrophes, hyphens and non-Latin text. Limits count Unicode code points, not UTF-16 units: 1-80 after trimming. Reject controls, unpaired surrogates, directional override/isolate controls and invisible-only values. Legitimate joiners within visible names remain permitted. Raw input safety limits are 64 UTF-16 units for usernames and 320 for display names before normalization. Render names as text, never trusted HTML.

## Rename Transaction

1. Lock the account row and verify access state.
2. Read its current identity and the database clock after obtaining the lock.
3. Return the current identity without writing if the requested name is unchanged.
4. Enforce a 720-hour cooldown since the last actual rename. Initial name assignment does not start the cooldown; the first rename may happen immediately. At exactly 720 hours, another rename is permitted.
5. Retire the current name, claim the new one and record the change time in one transaction. A conflict rolls back the retirement and does not consume the cooldown.

Different simultaneous renames for one account serialize on the row lock. Identical retries become no-ops after the first succeeds. Competing accounts are additionally protected by the username primary key. Retired names remain reserved; account IDs do not change.

This makes same-name rename retries safe, not all future signup/payment operations idempotent. Creation retries that repeat a committed username return a conflict; authentication orchestration must provide its own recovery contract.

## Errors and Verification

Domain errors expose stable codes, safe messages and optional field/next-eligible-date data. Only the known username primary-key conflict becomes `USERNAME_UNAVAILABLE`; unexpected database failures are not disguised as validation errors. Raw SQL, parameters and driver messages must never reach users or application logs.

The local suite exercises the real service/repository against PGlite with all checked-in migrations. It covers normalization, invalid fields, reserved names, rollback, history, cooldown, no-op retries and access state. Native PostgreSQL tests additionally cover competing renames and duplicate simultaneous retries; those remain unrun in this restricted workspace. No CI workflows were created or modified for this feature.

Existing low-level account rows without profiles are not silently given invented names. Before importing real legacy users, define a backfill or onboarding-completion flow. The previous feature created no public signup endpoint and no live user migration is being performed here.

Related: [validation rules](PointRush_Validation_Approval_Rules.md), [database operations](DATABASE.md), [Drizzle transactions](https://orm.drizzle.team/docs/transactions), [PostgreSQL row locks](https://www.postgresql.org/docs/current/explicit-locking.html).
