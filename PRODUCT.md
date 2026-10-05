# Acticlaim product direction

Agreed 4 October 2026. This document is the current product direction. Where it conflicts with Acticlaim_PRD.md, this document wins. The PRD remains the detailed reference for rules it does not contradict.

## One sentence

Businesses lock money to pay for verified outcomes (a real purchase or completed work); people earn from those outcomes and build a record nobody can fake.

## Three parts, one engine

All three parts use the same locked-funding ledger, verification and dispute machinery.

| Part               | Who pays                                    | What is verified                                                | What the person gets                                         |
| ------------------ | ------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| Purchase campaigns | A business, from funds it locked in advance | A real purchase, confirmed at the till                          | Cash back after the refund window                            |
| Jobs               | A business or client, from locked funds     | Submitted work, reviewed with correction and independent appeal | Payment and a verified job record                            |
| Credibility        | Nobody buys it; it is derived               | Only settled platform records                                   | A public profile: purchases, jobs, distinct businesses, tier |

Points, tiers and referrals are a platform-funded layer on top. They reward real, settled activity and never replace business-funded cash back or job payments.

## Removed

Paid follows, likes, shares, joins of social communities and other engagement missions are removed. They break social platform rules, attract bot farms and cannot be verified once the action is undone. No code path supports them.

## Purchase campaigns

A business creates a campaign such as "100 buyers, ₦500 back each, minimum spend ₦3,000". The full budget (capacity × cash back) locks atomically when the campaign is created, through the existing sponsor funding ledger. Platform review and publication rules are unchanged.

1. A shopper activates the offer and receives a one-time purchase code, shown as a QR code and as typed characters. It expires after 15 minutes and works once.
2. At the till the business scans or types the code and records the amount spent. The database checks: the business owns the campaign, the code is unexpired and unused, the shopper is not the business owner, the amount meets the minimum, the campaign is live, and confirmed purchases have not reached capacity.
3. The cash back is pending for the campaign's hold period (refund window, 1 to 30 days). The business can void it during the hold with a reason (for example, a refund). A voided purchase frees its place for another shopper.
4. After the hold the shopper releases it into their reward wallet. The ledger moves money from the campaign allocation exactly once.

A printed static QR code is never proof. The code is per shopper, per campaign, short-lived and single-use. One confirmed purchase per shopper per campaign. A shopper may have at most a configured number of confirmations per day across all campaigns.

Only the business's own locked money pays cash back. The platform never subsidises it, so a business that fakes purchases with friends only spends its own funds.

The business sees confirmations, voids, releases and the share of shoppers who came back. Campaign designs that reward return visits are a planned extension.

## Claim-code prize promotions

A business runs its own promotion (scratch papers, codes under caps, one code per pack) and locks the prize money with Acticlaim. Acticlaim generates the codes, verifies each claim once and pays the prize. Every code created on Acticlaim is funded and wins; Acticlaim runs no games of chance. Prize claims never earn points or tier credit. See PROMOTIONS.md.

## Points, referrals and tiers

These are platform-funded, so they carry the fraud risk. Controls are enforced in the database, not only in the service layer.

- Points come from a capped, founder-funded pool. Issuance can never exceed the pool. Every entry is append-only; corrections are compensating entries.
- Points are earned only from settled events: a released purchase or an approved job. Pending activity earns nothing. A voided purchase earns nothing.
- Points stay pending for a hold period and then become available.
- Referral rewards need a qualified referee: a verified phone, plus a released purchase or approved job at a business not owned by the referrer. Self-referral and circular referral are rejected. Each referrer has a monthly cap.
- Tiers are calculated from settled activity across distinct businesses, not from points balance, spending or referral counts. Repeated activity with the same business counts once.
- Phone verification needs an SMS provider that is not yet configured. Until it is, referral rewards cannot qualify. This is deliberate: platform money stays protected.

## Jobs and credibility

Jobs are the existing capped-fixed task flow: locked funds, proof, sponsor decision, one correction, independent appeal and exactly-once reward. The public profile shows only what settled records prove.

## Payments

Business funding and shopper payouts will use Bachs. Its payout coverage, recipient verification and fund-holding terms must be confirmed from its documentation before integration. The provider-agnostic foundation (verified funding, held withdrawals, one-time settlement) exists; see PAYMENTS.md. No real money moves until the Bachs adapter, payout destinations and reconciliation are in place.

## Success test for the pilot

Run in one dense area, such as a campus. Continue expanding only if at least 30% of businesses fund a second campaign and shoppers return without cash back.
