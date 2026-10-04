# Points, referrals and tiers

Migration 0015. Product rules: [PRODUCT.md](PRODUCT.md). Points are platform-funded, so every rule below is enforced by database triggers and direct inserts cannot bypass them.

## Points

- Issuance capacity is the sum of `points_pools` rows (append-only). An award that would exceed it is skipped. Pools are created by an operator; there is no HTTP route.
- Points come only from settled activity, awarded automatically: a released purchase or a paid job. Awards never block the settlement that triggered them.
- Purchase points are worth at most a fifth of the cash back (1 point = 10 kobo), capped at 50 per purchase. Job points use the same ratio, capped at 300. Each person earns purchase points and job points once per business, so a business and its friends cannot farm points with tiny repeated campaigns.
- A verified phone is required. Activity before phone verification earns no points.
- Points are pending for 72 hours, then available. Redemption is not implemented.

## Referrals

- POST `/api/v1/points/referral` `{username}`: a new account (under 7 days old, with no settled activity) names its referrer. One referrer per account.
- Rejected: self-referral, circular referral, a referrer with no settled activity of their own, more than 20 attributions per referrer in 30 days.
- Reward (referee 200, referrer 500) only when the referee has a verified phone and settled activity at a business the referrer does not own. A referrer earns at most 5 referral rewards in 30 days.
- Phone verification needs an SMS provider that is not configured, so referral rewards cannot qualify in production yet.

## Tiers

Calculated from distinct businesses with settled activity: New (0), Bronze (3), Silver (10), Gold (25). Points, spending and referrals never change a tier. Thresholds are provisional and live in `points.service.ts`. Tiers do not unlock anything yet.

## Routes

GET `/api/v1/points` returns available and pending points, tier with the next threshold, phone status and referral details. GET `/api/v1/points/entries` lists entries.

## Verification and gaps

PGlite tests cover pool caps, no-pool and no-phone settlement, the purchase ratio and per-business limit, forged inserts, immutable history, referral eligibility, circular and late referrals, referrer-owned businesses, delayed phone qualification and the monthly reward cap. Pool serialization uses a transaction advisory lock; it has not yet been exercised by a native concurrent test. Device and IP signals, reversals and redemption are not implemented.
