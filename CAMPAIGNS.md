# Purchase campaigns

Migration 0014. Product rules: [PRODUCT.md](PRODUCT.md). A business pays cash back from its own locked funds for purchases it confirms at the till.

## Flow and routes

| Route                                      | Who      | Behaviour                                                                                                                                                                         |
| ------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/api/v1/sponsor/tasks`               | Business | `model: "purchase_cashback"` with `campaignTerms {minSpendKobo, holdHours 24–720, placeName, placeAddress}`. Locks capacity × cash back atomically. Work terms are rejected.      |
| POST `/api/v1/work/tasks/:id/publish`      | Business | Existing review and full-backing gates, plus campaign-terms validation.                                                                                                           |
| POST `/api/v1/campaigns/:id/codes`         | Shopper  | Issues (or reuses) a 10-character single-use code, valid 15 minutes. Shown as `XXXXX-XXXXX` and QR.                                                                               |
| POST `/api/v1/campaigns/:id/confirmations` | Business | `{id, code, amountKobo}`. Idempotent on `id`.                                                                                                                                     |
| GET `/api/v1/campaigns/:id/summary`        | Business | Confirmed, voided, released, remaining places, returning shoppers and recent purchases.                                                                                           |
| GET `/api/v1/purchases`                    | Shopper  | Own purchases with state `pending`, `releasable`, `released` or `voided`.                                                                                                         |
| POST `/api/v1/purchases/:id/voids`         | Business | `{reason}` during the hold only; at most 20% of the campaign's purchases (never fewer than 3).                                                                                    |
| POST `/api/v1/purchases/:id/disputes`      | Shopper  | `{note}` within 7 days of a void: "this was a real purchase". A reviewer decides (`GET /api/v1/admin/disputes`, `POST /api/v1/admin/disputes/:id/rulings` with `{decision: upheld | reversed, reason}`). |
| POST `/api/v1/purchases/:id/releases`      | Shopper  | After the hold. Credits the reward wallet exactly once.                                                                                                                           |

Conflicts return HTTP 409 with a stable `reason`: `campaign_full`, `daily_limit`, `code_rate_limit`, `offer_unavailable`, `confirmation_rejected`, `void_rejected`, `void_limit`, `dispute_unavailable`, `not_releasable` or `not_eligible`.

## Database-enforced rules

- Codes: per shopper and campaign, single-use (unique per confirmation), 15-minute expiry from the database clock, at most 10 per shopper per campaign per hour. The business owner cannot obtain a code for its own campaign.
- Confirmation: only the campaign owner; live, published, approved campaign; unexpired code bound to the same campaign and shopper; amount at or above the minimum spend. Capacity counts unvoided confirmations and is serialized by locking the campaign row. One confirmation per shopper per campaign. At most 5 confirmations per shopper per 24 hours across all campaigns, serialized per shopper.
- Void: owner only, before the hold ends, never after release, and at most 20% of a campaign's purchases (always at least 3), so a business cannot take the extra sales and cancel everyone's cash back.
- Dispute: the shopper may dispute a void for 7 days. Until then, or until a reviewer decides a dispute, the voided purchase keeps its place and its money stays locked in the campaign (it cannot be returned to the business). A reviewer (never the business owner or the shopper) either upholds the void, or reverses it, which pays the shopper at once with a `void_reversal` transfer from the campaign. Shoppers see each business's void rate (last 180 days, once it has 10 purchases) on its offers.
- Release: shopper's own confirmation, after the hold, never when voided. The ledger accepts a `purchase_cashback` transfer only for a released, unvoided confirmation, to that shopper's wallet, for exactly the campaign cash back.
- All campaign tables are append-only.

## Verification

PGlite tests cover the full flow, idempotent retries, code replay, minimum spend, foreign businesses, capacity and voids, expiry, daily and minting limits, and direct-write bypass attempts. A test-only `clock_timestamp()` shadow crosses the hold. Native PostgreSQL tests prove two tills cannot both take the last place and concurrent releases pay once. HTTP tests cover session, Origin, validation and conflict reasons.

## Known limits

- Only the business owner's account can confirm at the till. Cashier delegation needs business membership.
- Unused campaign funds stay locked after the campaign ends; settlement and refunds are not implemented.
- Shopper payout from the reward wallet (Bachs) is not implemented.
- Return-visit campaign designs are planned, not built.

## Returning unused money (migration 0020)

POST `/api/v1/campaigns/:id/returns` with `{id}` (idempotent) returns campaign money to the business's available balance. The database computes the amount; the caller never supplies it.

- Before publication: the whole remaining budget, and the campaign is cancelled. It can then be neither approved nor published (`campaign_cancelled`).
- After a cash back offer or prize promotion ends: the balance minus cash back still owed to shoppers (confirmed, not voided, not yet released) and voided cash back still open to a dispute. That owed money stays locked until each shopper releases it. Returns can be repeated as more becomes free.
- Live campaigns (`funds_in_use`) and published jobs keep their money; jobs can still be paid through open appeals.
- Reasons: `return_unavailable`, `funds_in_use`, `nothing_to_return`, `campaign_cancelled`.

Known limit: cash back a shopper never releases stays locked indefinitely. An automatic release after a long grace period is a later decision, since it moves money without the shopper's action.

## Till staff (migration 0022)

An owner adds up to 20 staff by Acticlaim username (`POST /api/v1/business/staff` with `{id, username}`, idempotent; `POST /api/v1/business/staff/:id/removals`). Staff can confirm purchases and read the till summary; nothing else. Voiding, money, campaigns, prize codes and staff management stay with the owner.

The database enforces it: confirmations accept the owner or an active staff member with an active account; staff can neither get cash back codes nor claim prizes from the business they work for; removal takes effect at once and is append-only. Staff see their tills at `/staff` (`GET /api/v1/staff/workplaces`).
