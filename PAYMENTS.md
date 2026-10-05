# Payments

Migration 0018. Money enters when a business funds its account and leaves when a person withdraws their wallet. Acticlaim talks to one payment provider through a narrow adapter (`apps/api/src/payments/provider.ts`). The intended provider is Bachs; its adapter is not written yet because its documentation could not be reviewed from the build environment. A signed test provider stands in and is refused in production.

## Routes

| Route                                      | Who      | Behaviour                                                                                                                                                                |
| ------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST `/api/v1/payments/funding-intents`    | Business | `{id, amountKobo}` (₦1,000 to ₦100,000,000). Records the intent, then returns the provider `checkoutUrl`. A retry after checkout started is `checkout_started`.          |
| POST `/api/v1/payments/webhooks/:provider` | Provider | Public; authenticated only by the provider signature over the exact raw body. 400 when it cannot be verified, otherwise 200 with the outcome.                            |
| POST `/api/v1/wallet/withdrawals`          | Person   | `{id, amountKobo, password}` (₦1,000 to ₦5,000,000). The password is checked again. Idempotent on `id`. Moves the money into a hold at once.                             |
| POST `/api/v1/wallet/lock`                 | Person   | "This wasn't me": locks withdrawals and stops any not yet sent to the bank. Only a different reviewer can unlock (`POST /api/v1/admin/accounts/:id/withdrawal-unlocks`). |
| GET `/api/v1/wallet/withdrawals`           | Person   | Own withdrawals, newest first, with state `held`, `sent`, `paid` or `failed`.                                                                                            |

Reasons: `payments_unavailable` (503, no provider configured), `checkout_started`, `withdrawal_unavailable` (inactive account or no verified phone), `withdrawal_daily_limit`, `insufficient_balance`, `password_required` (missing or wrong password), `withdrawals_locked`.

Every bank account added sends the owner an email (through the sign-in email queue, with no links) and an in-app notice. The ₦1,000 minimum keeps payout fees, which Acticlaim pays, from being drained by many tiny withdrawals.

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

## Bachs (migration 0025)

The Bachs adapter (`apps/api/src/payments/bachs.ts`) follows https://docs.bachs.io:

- **Funding.** `POST /v1/checkout-sessions` with a raw NGN amount (`pricing`), our intent ID as `reference`, NGN card and bank transfer only, and `Idempotency-Key: checkout:<intent>`. The business returns to `/business/funds?paid=1`, but only the `collection.succeeded` webhook credits. It must carry our reference, the exact amount, NGN and `status: SUCCEEDED`; `ACCEPTED` or `OVERPAID` collections go to review as `mismatch`.
- **Bank accounts.** `POST /v1/payouts/destinations` checks the account at the bank. Only an `approved` account is saved, with the bank's own account name and the last four digits; the full number is not stored. A changed account cannot receive money for 24 hours, and at most three accounts can be added in 30 days.
- **Payouts.** `POST /v1/payouts` to the saved destination, with the withdrawal ID as `reference` and `Idempotency-Key: withdrawal:<id>`, so a retry never pays twice. The amount is what the person receives; Bachs charges its fee on top, from Acticlaim's balance. `payout.paid` and `payout.failed` settle the withdrawal.
- **Failures.** A rejected destination ends the withdrawal and returns the money. Anything else (Bachs unreachable, `INSUFFICIENT_BALANCE`, `ORGANIZATION_IN_DEBT`, rate limits) leaves it held and is retried with the same key.
- **Webhooks.** `X-Bachs-Signature-V2` (`t=…,v1=…`, any `v1` may match during a secret rotation) over `<timestamp>.<raw body>`, five-minute window, falling back to the `X-Bachs-Timestamp`/`X-Bachs-Signature` pair. Unknown fields are ignored.
- **Payout job.** `npm run payments:payouts -w @pointrush/api` sends held withdrawals in one finite batch. Run it on a schedule (for example every five minutes). Exit code 2 means some payouts were deferred and need a person to look.

### Configuration

| Variable                  | Value                                                                    |
| ------------------------- | ------------------------------------------------------------------------ |
| `PAYMENTS_PROVIDER`       | `bachs` (or `test`, refused in production)                               |
| `BACHS_API_KEY`           | `sk_sandbox_…` outside production, `sk_live_…` in production (enforced)  |
| `PAYMENTS_WEBHOOK_SECRET` | The signing secret of the webhook endpoint in the Bachs developer portal |
| `PAYMENTS_RETURN_ORIGIN`  | The web app origin, e.g. `https://acticlaim.com`                         |

Without a provider, payment routes return `payments_unavailable`. Keys and secrets belong in the deployment's secret store, never in Git or chat.

### In the Bachs dashboard

1. Create a sandbox secret key with checkout, payouts and payout-destination scopes.
2. Add a webhook endpoint `https://<api host>/api/v1/payments/webhooks/bachs` subscribed to `collection.succeeded`, `payout.paid` and `payout.failed`, and copy its signing secret.
3. Decide who pays the collection fee. If Acticlaim (the merchant) bears it, every ₦100,000 funded costs Acticlaim the fee; set the customer as fee bearer in the checkout settings, or price it in.
4. Keep Acticlaim's Bachs balance above pending withdrawals plus fees; payouts are paid from it.

## Verification

PGlite tests cover forged, stale and tampered webhooks, duplicate and retried events, amount and currency mismatches, unknown references, forged ledger credits, immutable history, withdrawal holds, insufficient balance, idempotent retries, single submission, paid, failed and contradicting outcomes, and the daily limit. HTTP tests prove the webhook route is public, uses the raw body and rejects re-serialised JSON. Native PostgreSQL tests prove concurrent duplicate deliveries credit once and racing withdrawals from two pools cannot overdraw a wallet.

## Release gates and known gaps

- **Sandbox run.** The adapter is tested against the documented formats, not yet against the live sandbox. Run one funding and one payout end to end in the Bachs sandbox before going live.
- **Reconciliation.** Provider settlement reports should be matched against the ledger daily; flagged events have a review screen (`/review/payments`).
- **Withdrawal fees.** Bachs charges per payout on top of the amount; Acticlaim currently absorbs it.
- **Phone verification.** Withdrawals need a verified phone, which needs a real SMS provider (PHONE.md).
- Only NGN is supported.
