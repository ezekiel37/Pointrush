# Acticlaim security and fraud review

October 2026. Scope: the API, database rules, payments (Bachs), web app and the business model itself. Each finding was checked against the code, not assumed. Severity reflects real-world likelihood and money at risk, not only technical difficulty.

The core money engine is strong: every naira moves through a double-entry ledger whose rules are enforced by the database, every money-moving request is idempotent, webhooks are signed and replay-protected, and concurrency races are tested on real PostgreSQL. The serious risks are not "hackers breaking in"; they are people using the product exactly as designed to move money where it should not go.

## Status (5 October 2026)

| Item                  | Status                                                                                                                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 stolen cards       | **Partly fixed**: funding is bank transfer only (no cards). Dispute handling and business verification still open.                                                                                                                            |
| C2 regulation         | Open. Bachs's terms say each business remains responsible for its own regulatory obligations; its licence does not cover Acticlaim. Needs a lawyer.                                                                                           |
| C3 withdrawal limits  | **Lowered**: at most ₦1,000,000 per withdrawal and per day in total, three withdrawals a day. BVN tiers still open.                                                                                                                           |
| C4 account takeover   | **Fixed**: email and in-app alert on every bank account added; "This wasn't me" locks withdrawals and stops any not yet sent; password asked again on every withdrawal (10 tries a minute); a different reviewer must unlock.                 |
| H1 void abuse         | **Fixed**: voids capped at 20% of a campaign's purchases (at least 3); shoppers can dispute a void for 7 days and a reviewer decides; voided money stays locked until then; each business's void rate is shown on its offers.                 |
| H2 cashier fraud      | **Mostly fixed**: per-staff totals today and this week, cash back this week, a warning when a cashier confirms the same shopper 3+ times a week, and a cap of 100 confirmations per cashier a day (database rule). Receipt numbers not added. |
| H3 leaked prize codes | Open.                                                                                                                                                                                                                                         |
| H4 SIM farms          | Open.                                                                                                                                                                                                                                         |
| H5 fee scams          | Ongoing: the app says Acticlaim never charges to claim; alert emails repeat it.                                                                                                                                                               |
| M1 staff consent      | **Fixed**: a person must accept the invitation before they become staff.                                                                                                                                                                      |
| M2 fee drain          | **Fixed**: minimum withdrawal ₦1,000.                                                                                                                                                                                                         |
| M3 balance shortfall  | Open: needs the Bachs balance API in the daily job.                                                                                                                                                                                           |
| M4 refund after hold  | **Fixed**: the campaign form tells businesses to choose a hold at least as long as their refund policy.                                                                                                                                       |
| M5 single reviewer    | **Fixed**: campaigns of ₦1,000,000 or more need two different reviewers; the reviewer who froze an account cannot unfreeze it alone.                                                                                                          |
| M6 edge rate limits   | Open: set at Cloudflare at deployment.                                                                                                                                                                                                        |
| M7 permits            | Process: keep a register of verified permits.                                                                                                                                                                                                 |

## What Bachs's documentation says (checked 5 October 2026)

- **Licence.** Bachs verifies Acticlaim (product, owner ID through Smile ID, bank account) but states that "you remain responsible for your own tax and regulatory obligations". Nothing says Bachs's licence covers a platform holding other people's money. Bachs Connect gives each business and person its own balance held by Bachs, which may help, but this needs a lawyer's opinion.
- **Prohibited businesses.** Bachs lists "gambling and games of chance" and "unlicensed financial services" as not permitted. Acticlaim removed chance-mode promotions: every code created on Acticlaim is funded and wins.
- **USDT.** Bachs collects USDT (TRC-20, BEP-20, ERC-20, Solana) and pays out USDT on TRC-20 and BEP-20, from a USD balance. Withdrawals cost 1% (minimum 1 USDT). Acticlaim does not use it: crypto payouts cannot be reversed, are harder to trace, and make the laundering risk in C3 worse.
- **Balance.** `GET /v1/balances` returns Acticlaim's available and pending balance per currency. M3 is a daily job that compares it with what Acticlaim owes.
- **Deposit limits.** Each Bachs account has a per-charge limit that Bachs sets; large funding may fail with `DEPOSIT_LIMIT_EXCEEDED` until Bachs raises it.

## Critical: fix before real money

### C1. Stolen cards funding campaigns, cashed out through mule accounts

Scenario: a fraudster registers a business, funds ₦500,000 with a stolen card, creates a cash back offer, and "confirms purchases" at the till for 50 accounts they control (each with a cheap SIM). After the hold, the mules withdraw to bank accounts. Weeks later the card owner files a chargeback. Bachs takes the money back from Acticlaim, which has already paid it out.

Why it works today: card funding is enabled (`NGN_CARD`), funding is spendable at once, there is no dispute handling (`dispute.created` is ignored), and nothing links mule accounts.

Fix:

1. Accept only bank transfer for funding until there is a fraud team (bank transfers cannot be charged back). One-line change in the Bachs adapter.
2. Handle `dispute.created` / refund events: freeze the business, its campaigns and its staff, and flag accounts that were paid from it.
3. Business verification (BVN or CAC for registered businesses) before the first campaign.

### C2. Acticlaim is holding customer money, which is regulated

Business balances and user wallets are stored value. In Nigeria, holding and paying out third-party funds without a licence (or a licensed partner holding them) is a CBN regulatory problem, not a technical one.

Fix: confirm with a fintech lawyer before launch. Bachs Connect (a balance per business and per payee, held by Bachs) may be the compliant structure; the current design keeps everything in Acticlaim's own Bachs balance.

### C3. Withdrawal limits are far too high for unverified people

A phone-verified account can withdraw up to ₦5,000,000 per withdrawal, three times a day (₦15m/day), with no identity check. That is a money-laundering channel.

Fix: tiered limits. For example ₦20,000/day with phone only, ₦200,000/day with BVN, higher on review. Daily and monthly totals, not only count.

### C4. Account takeover empties the wallet

Scenario: an attacker phishes or reuses a password, adds their own bank account, waits out the 24-hour delay, withdraws.

What exists: the 24-hour delay on a changed bank account. What is missing: the real owner is never told their bank account changed, and withdrawing needs no fresh confirmation.

Fix: email and in-app alert on every bank-account change, with a one-click "this wasn't me" that freezes withdrawals; ask for the password (or an SMS code) again before a withdrawal.

## High

### H1. Dishonest business: take the sales, void every cash back

Scenario: a business runs "₦1,000 back", gets the extra sales, then voids every purchase during the refund window with "refunded", and after the campaign ends takes the voided money back. Shoppers are cheated and blame Acticlaim.

Today: voids need only a reason; there is no cap and no visibility.

Fix: show each business's void rate on its offers; voids above a threshold (for example 10% of confirmations) need reviewer approval; let shoppers dispute a void; voided money cannot be returned to the business until disputes close.

### H2. Cashier fraud: staff confirming purchases that never happened

Scenario: a cashier confirms codes from friends who bought nothing; the business pays cash back for fake sales.

Today: each confirmation records who confirmed it, but the owner cannot see it per staff member and there are no limits.

Fix: per-staff confirmation list and totals for the owner; optional receipt number on confirmation; alert when one staff member confirms the same shoppers repeatedly; per-staff daily caps.

### H3. Leaked prize codes claimed by insiders

Scenario: someone at the printer, or a staff member with the CSV, claims winning codes before the papers reach customers. This is the most common real-world failure of scratch-card promotions.

Today: codes only work after the business activates the batch, and the prize goes to the wallet instantly and can be withdrawn the same day.

Fix: hold cash prizes for 24-48 hours before they can be withdrawn; flag a batch when many codes are claimed soon after activation or by accounts that never bought anything; let the business freeze a batch (exists) and reverse unwithdrawn prizes from a leaked batch.

### H4. One person, many accounts (SIM farms)

A verified phone proves a SIM, not a person. SIMs are cheap. One person can collect "one per person" cash back many times (with real purchases), claim more prizes than the per-person limit, and farm referral points.

Impact is limited (purchases are real; points are not cash), but it breaks the "one per person" promise businesses pay for.

Fix (in order of cost): flag accounts sharing a bank account (store a keyed hash of bank code plus account number; today nothing links them); device and network signals; BVN for withdrawals above a small amount (C3) closes most of it.

### H5. "Pay a fee to claim your prize" scams using the Acticlaim name

Scenario: scammers print fake scratch cards or send SMS ("You won ₦50,000 on Acticlaim, pay ₦2,000 processing fee"), or build a lookalike site to steal logins.

Fix: state everywhere, including on printed promotion templates, that Acticlaim never charges to claim; verified-business badges; register lookalike domains; a public "check a promotion" page.

## Medium

- **M1. Staff added without consent.** An owner can add any username as staff, which silently stops that person earning cash back there. Require the person to accept.
- **M2. Payout fee drain.** Bachs charges per payout and Acticlaim pays it; minimum withdrawal is ₦500. Many small withdrawals cost real money. Charge a small fee or raise the minimum.
- **M3. Acticlaim's own balance can run short.** Payouts come from one Bachs balance; nothing compares the ledger with the real balance. Daily reconciliation and an alert when pending withdrawals exceed the balance.
- **M4. Refund after the hold.** A shopper can return goods after the cash back unlocks. Businesses must set the hold at least as long as their refund policy; say so in the form.
- **M5. Single-reviewer power.** One reviewer can approve any campaign or freeze any account. Require a second reviewer for campaigns above a set budget and for unfreezing accounts frozen for fraud.
- **M6. Rate limits are per server instance.** With several instances the limit multiplies; per-visitor limits must be set at the edge (Cloudflare). Already documented as a release gate.
- **M7. Fake "chance" permits.** Permit numbers are typed by the business and checked by a person. Keep a record of verified permits and check them with the issuing authority for large promotions.

## Low

- Phone codes and vouchers use an unkeyed hash; a stolen database copy could brute-force a live 6-digit code within its 10 minutes. Use a keyed hash.
- The landing page shows example figures that are fixed text; keep them clearly labelled as examples.
- Prize code CSV export contains only codes (no spreadsheet-formula risk); keep it that way.

## Already handled well

- Money cannot be created or moved outside the ledger rules; forged transfers are rejected by the database (tested).
- Each purchase code works once, for one shopper, for 15 minutes; a photo of a code is worthless.
- Prize codes have 16 random characters, are stored hashed, and guessing locks an account after 10 failures.
- Business owners and staff cannot earn or claim at their own business; reviewers cannot review their own campaigns.
- Webhooks: signature over the raw body, five-minute window, deduplicated, amount and currency must match.
- Payouts and funding are idempotent; network failures never pay twice.
- A changed bank account waits 24 hours; at most three accounts in 30 days; the bank's own account name is shown.
- SMS limited per account, per number, per day and per country (SMS-pumping fraud).
- Physical prizes: a business cannot mark an item handed over without the winner's code.

## Recommended order

1. C1 (bank transfer only, dispute handling), C3 (limits), C4 (alerts and re-confirmation), H3 (prize hold). Code changes, about a week.
2. H1 and H2 (void controls, staff visibility). About a week.
3. C2 legal opinion and BVN/CAC verification: start now; they take the longest.
4. H4, H5 and the medium items as the pilot grows.
