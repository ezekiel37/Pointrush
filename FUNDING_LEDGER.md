# Sponsor funding ledger foundation

This document describes migration 0007's internal persistence primitives. Migration 0008 now adds owner-bound sponsor profiles and atomic funded task creation; see [SPONSOR_TASKS.md](SPONSOR_TASKS.md) for that implemented scope. No HTTP endpoint can credit funds and no real provider transaction is processed. Apply migrations only through the normal migration process; neither has been applied to a hosted database.

## Money and ownership

Amounts are positive bigint kobo; NGN is the only supported currency. JavaScript numbers, fractional values and numeric strings are rejected by the internal command. A future HTTP contract must explicitly parse decimal integer strings and return amounts as strings. The maximum individual transfer is PostgreSQL's signed bigint limit, a technical bound rather than an approved product transaction limit. Commercial limits still need configuration before money enters the product.

Funding accounts have three buckets: external clearing, sponsor available and task locked. The latter has a globally unique allocation UUID. Sponsor ownership points to an existing PointRush account; business/team delegation is not implemented. An allocation UUID is not evidence of platform approval. Migration 0008 binds funded tasks to allocations with a foreign key and ownership/backing checks in the same transaction.

Each immutable transfer debits one funding account and credits another by the same amount. A balance is the sum of its postings; there is no editable balance column. Only external clearing may be negative. Its negative balance is the counterpart of confirmed sponsor funding, not a bank balance or proof of settlement. Reconciliation with the payment provider remains required.

## Supported operations

- `funding_confirmed`: clearing to sponsor available. Only a future trusted payment handler may call this after verifying provider reference, account, amount, currency and final status. The ledger itself cannot authenticate a payment receipt. Use a stable provider-scoped reference and actor/reason across retries.
- `task_lock`: sponsor available to that same sponsor's task allocation. The actor must be the owner and the account active. Team/admin delegation is intentionally absent until authorization rules exist.

Use `postFundingTransfer` inside a caller transaction when creating an allocation or a funded task. A failed lock rolls back the caller's creation. Do not create a task and then fund it in a separate commit. This primitive also supports top-ups with separate operation references; versioned task approval remains the caller's responsibility.

The command UUID and `(kind, reference)` identify retries. Equivalent retries return the original journal row, including a provider replay arriving with a new command UUID. Changed amounts, destinations, actor, reason or reference on an existing command conflict. Preserve the returned canonical ID. No idempotency expiry or journal deletion is implemented.

## Database safeguards

Migration 0007 adds standard PostgreSQL tables, constraints and PL/pgSQL triggers. Transfers and account ownership/bucket records reject update, delete and truncate. Corrections must use explicitly designed compensating operations, which this slice does not expose. Row locks taken in UUID order serialize concurrent debits. Available funds are calculated after the locks; direct inserts must obey the same funding paths and non-negative balance rule as service calls. The write path requires READ COMMITTED and rejects other isolation levels, avoiding stale-snapshot balance decisions.

Idempotency advisory locks serialize replay identities. Caller transactions should be short and perform no external requests. Deadlock/serialization failures must retry the whole business command with the original identities. Do not catch a database failure and continue a partially failed task operation.

Use a non-owner runtime database role without DDL, trigger-disable or superuser privileges. Triggers do not protect against a privileged operator intentionally disabling them. Runtime grants and restore procedures are deployment gates. Drizzle snapshots do not represent custom trigger bodies: preserve the checked-in SQL when generating future migrations. No provider-specific SQL extension is required.

## Verification and remaining work

PGlite tests cover the PRD's ₦50,000 minus ₦20,000 allocation example, replay conflicts, duplicate provider references, exhausted-balance retry, rollback of allocation creation, cross-owner transfers, forbidden locked-fund spending, immutable records, integer precision, invalid amounts, inactive sponsors and direct-insert overdrafts. A native PostgreSQL two-connection competing-allocation test is checked in, but requires the existing `test:db` environment and has not been run here. PGlite does not establish native concurrency correctness.

Before public funding: run native concurrency tests; complete business delegation, task review/version rules and publication gates; add verified payment inbox/reconciliation; and set commercial limits and backup/restore procedures. Owner-authorized profiles and atomic funded task records are now covered by SPONSOR_TASKS.md. Participant commitments, earned-points backing, fees, releases, refunds, chargebacks and user rewards are separate forthcoming operations. Locked money currently has no release path, deliberately preventing premature refunds. These primitives must not be presented as a usable wallet, legal escrow or launch-ready financial system.
