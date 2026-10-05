# Payments

Migration 0018. Money enters when a business funds its account and leaves when a person withdraws their wallet. Acticlaim talks to one payment provider through a narrow adapter (`apps/api/src/payments/provider.ts`). The intended provider is Bachs; its adapter is not written yet because its documentation could not be reviewed from the build environment. A signed test provider stands in and is refused in production.

## Routes

| Route                                      | Who      | Behaviour                                                                                                                                                       |
| ------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/api/v1/payments/funding-intents`    | Business | `{id, amountKobo}` (₦1,000 to ₦100,000,000). Records the intent, then returns the provider `checkoutUrl`. A retry after checkout started is `checkout_started`. |
| POST `/api/v1/payments/webhooks/:provider` | Provider | Public; authenticated only by the provider signature over the exact raw body. 400 when it cannot be verified, otherwise 200 with the outcome.                   |
| POST `/api/v1/wallet/withdrawals`          | Person   | `{id, amountKobo}` (₦500 to ₦5,000,000). Idempotent on `id`. Moves the money into a hold at once.                                                               |
| GET `/api/v1/wallet/withdrawals`           | Person   | Own withdrawals, newest first, with state `held`, `sent`, `paid` or `failed`.                                                                                   |

Reasons: `payments_unavailable` (503, no provider configured), `checkout_started`, `withdrawal_unavailable` (inactive account or no verified phone), `withdrawal_daily_limit`, `insufficient_balance`.

## Money in

1. The business creates an intent. Acticlaim stores it before calling the provider, never calls the provider inside a database transaction, and records the provider session ID once.
2. The browser's return from checkout proves nothing and moves no money.
3. A verified `collection.succeeded` webhook whose reference, amount and currency match the intent credits the business's available balance with a `funding_confirmed` transfer referenced `intent:<id>`. The ledger trigger refuses any funding credit that does not match its intent, and the transfer ID is the intent ID, so a provider retry under a new event ID cannot credit twice.

## Money out

1. A withdrawal requires an active account with a verified phone and allows three a day. In the same transaction the amount moves from the wallet to `payout_hold`, so it cannot be spent or withdrawn twice.
2. `PaymentsService.submitPendingWithdrawals()` hands held withdrawals to the provider. The withdrawal ID is the idempotency key.
3. A verified `payout.succeeded` closes the hold (to clearing); `payout.failed` returns the money to the wallet. Each withdrawal has one outcome, ever. A repeat of the same result is a no-op; a contradicting later event is recorded as `mismatch` and changes nothing.

## Webhook handling

Every verified event is stored once per provider event ID, behind an advisory lock so concurrent deliveries wait and then see it as handled. Only the fields needed to settle are kept; raw payloads (which carry personal data) are not. Outcomes: `credited`, `payout_paid`, `payout_failed`, `mismatch`, `unknown_reference`, `ignored`. **`mismatch` and `unknown_reference` need a person to look at them**; there is no review screen for them yet.

## Adapter contract

A provider adapter must:

- verify the signature over the raw request bytes with a constant-time comparison and reject stale timestamps (replay window);
- map provider decimals to exact kobo (`decimalToKobo`), never through floating point;
- return our intent or withdrawal ID as the event reference;
- make `createPayout` idempotent on `withdrawalId`: if Acticlaim stops after the provider accepts a payout but before recording it, the retry must return the same payout, not send a second one. If the provider has no idempotency key, the adapter must look up an existing payout by our reference before creating one.

## Database-enforced rules

- Intents cannot be changed except to record the provider session once.
- Funding credits must match an intent exactly; payout transfers must match their withdrawal and kind.
- Withdrawals need an active account, a verified phone and fewer than three in 24 hours; the hold is created by trigger.
- A withdrawal is submitted once and settled once; nothing is accepted after settlement.
- Payment events, withdrawals, submissions and outcomes are append-only.

## Configuration

`PAYMENTS_PROVIDER` and `PAYMENTS_WEBHOOK_SECRET` (at least 32 characters) must be set together. Only `test` exists today, and it is rejected when `NODE_ENV=production`. Without a provider, payment routes return `payments_unavailable`.

## Verification

PGlite tests cover forged, stale and tampered webhooks, duplicate and retried events, amount and currency mismatches, unknown references, forged ledger credits, immutable history, withdrawal holds, insufficient balance, idempotent retries, single submission, paid, failed and contradicting outcomes, and the daily limit. HTTP tests prove the webhook route is public, uses the raw body and rejects re-serialised JSON. Native PostgreSQL tests prove concurrent duplicate deliveries credit once and racing withdrawals from two pools cannot overdraw a wallet.

## Release gates and known gaps

- **Bachs adapter.** Needs its documentation reviewed: checkout sessions, webhook signature scheme, payout API and whether payouts are idempotent.
- **Payout destination.** Withdrawals do not yet record where the money goes (bank account or provider account). This must be added, with account-name verification, before real payouts.
- **Payout worker.** `submitPendingWithdrawals` has no scheduled runner yet (the email worker shows the pattern).
- **Reconciliation.** Provider settlement reports must be matched against the ledger daily, and `mismatch` events need an admin review screen.
- **Phone verification.** Withdrawals need a verified phone, which needs the SMS provider that is not configured yet.
- Only NGN is supported.
