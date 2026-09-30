# PointRush Testing, Risk, and Engineering Rules

Related contracts: [PRD](PointRush_PRD.md), [validation and approval](PointRush_Validation_Approval_Rules.md), [design](DESIGN.md), [UX behaviour](UX-CONTRACT.md). Acceptance cases below describe required future tests, not tests already implemented.

## 1. Purpose

This document exists to break the product before real users do.

The goal is to identify abuse paths, real-world failure cases, operational risks, software architecture rules, UI/UX rules, and testing standards before implementation starts.

PointRush touches rewards, trust, sponsors, user incentives, referrals, and redemption. That means weak product rules or messy code can quickly become financial loss, user anger, sponsor churn, or fraud.

## 2. Core Testing Mindset

Assume:

- Some users will try to farm points.
- Some users will create multiple accounts.
- Some users will lie to support.
- Some sponsors will write unclear missions.
- Some sponsors will reject valid submissions unfairly.
- Some providers will fail.
- Some admins will make mistakes.
- Some network requests will retry.
- Some webhooks will arrive twice.
- Some users will have bad phones and poor network.
- Some screens will be opened after stale state.
- Some users will misunderstand points as cash.

The system must survive these situations without losing money, breaking trust, or corrupting data.

## 3. User Abuse Scenarios

| Attack | Real Scenario | Required Defence |
| --- | --- | --- |
| Multi-account farming | One person creates many accounts to claim signup, referral, and mission rewards | Phone verification, device signals, IP checks, reward destination checks, suspicious cluster review |
| Referral rings | Groups coordinate to invite and approve each other | Referral reward only after verified activity and approved missions |
| Self-referral | User refers another account they control | Device, IP, phone, and reward destination matching |
| Screenshot recycling | Same screenshot is submitted by multiple users | Image hash, perceptual hash, duplicate proof detection |
| Edited proof | User edits screenshot, timestamp, username, or action | Metadata checks, manual review, AI-assisted image checks |
| Old proof | User submits proof from before joining mission | Proof must show current timestamp or server-verifiable event where possible |
| Follow-unfollow abuse | User follows sponsor, earns, then unfollows | Delayed approval or later recheck for social missions |
| Bot submissions | Automated scripts complete easy missions | Rate limits, suspicious velocity checks, CAPTCHA where needed |
| Redemption rush | User farms quickly and redeems before fraud review | First redemption manual review, minimum account age, tier gates |
| Support manipulation | User opens repeated complaints to force approval | Ticket limits, evidence-based decisions, admin review trail |
| Black-market points | Users sell accounts or points outside platform | Delay point transfer, monitor transfers, cap transfer amounts if introduced |

## 4. Sponsor Abuse and Failure Scenarios

| Scenario | What Can Break | Required Rule |
| --- | --- | --- |
| Vague mission instructions | Users submit wrong proof and blame PointRush | Mission template must require clear steps, proof example, and rejection reasons |
| Sponsor rejects valid submissions | Users lose trust | Admin arbitration must exist |
| Sponsor underfunds campaign | Users complete missions without guaranteed reward | Budget must be reserved before launch |
| Sponsor asks for spam | Platform reputation suffers | Admin campaign approval and prohibited campaign policy |
| Sponsor expects sales from awareness mission | Sponsor churns | Campaign objective must be explicit |
| Sponsor changes rules mid-campaign | User disputes increase | Rule changes apply only to future participants |
| Sponsor uploads harmful content | Legal/reputation risk | Admin review before public visibility |
| Sponsor disputes after completion | Platform may lose money | Store submission evidence and campaign terms |

## 5. Sponsor Funding, Locked Rewards, and Dispute Solutions

Sponsor-funded campaigns must not depend on verbal promises or unpaid budgets. If users can earn from a sponsor mission, the reward budget for that mission must already be funded, confirmed, and locked.

### 5.1 Required Sponsor Funding Flow

1. Sponsor saves an unfunded draft or creates a funded task from confirmed available funds.
2. Funded task creation atomically locks its full allocated reward budget; insufficient funds prevent funded creation.
3. Funding and sponsor/current-task-version review are independent publication gates.
4. Reward commitments within the lock follow the task model: selection for assignments, claim for capped tasks, disclosed rules for open campaigns.
5. Approval atomically converts a commitment into earned-point backing and credits the ledger once.
6. Pending work, corrections and appeals retain their funding.
7. Only settlement-authorised unused funds can be refunded, rolled over or released.

### 5.2 Sponsor Budget Rules

- Task-locked allocations cannot fund another task or be withdrawn.
- Campaign totals aggregate task allocations without double-counting.
- Stop new reward promises before overspending; do not impose automatic rewarded slots on open/selected tasks.
- Sponsor reward funds remain separate from founder-funded rewards and platform fees.
- Approved rewards remain backed until fulfilled or legitimately corrected; sponsor disagreement is not proof of fraud.
- Every allocation, commitment, approval, release, refund and rollover is ledgered.
- A local lock does not eliminate payment-provider chargebacks; track and resolve that risk separately.

### 5.3 Sponsor Edge Case Solutions

| Scenario | Solution |
| --- | --- |
| Sponsor creates campaign but does not pay | Keep campaign as draft or pending funding; users cannot see it |
| Sponsor pays but webhook is delayed | Keep campaign in pending funding until verified |
| Sponsor pays wrong amount | Keep campaign blocked until sponsor pays shortfall or edits campaign budget |
| Sponsor cancels before campaign goes live | Refund or sponsor credit based on policy |
| Sponsor cancels after users joined | Move campaign to closing state and protect users who already joined under old terms |
| Sponsor rejects valid work unfairly | Admin arbitration using stored campaign rules and submitted proof |
| Sponsor changes reward amount | Apply only to future participants |
| Sponsor changes proof rules | Apply only to future participants |
| Budget cannot cover promised rewards | Prevent the commitment before work starts; never solve overspending by rejecting valid work. Investigate any invariant violation |
| Sponsor claims fraud after approvals | Investigate; reverse only proven fraudulent rewards |
| Sponsor asks for refund after approved work | Do not refund approved user rewards unless fraud is proven |
| Sponsor mission violates policy | Reject or suspend campaign |
| Sponsor account is compromised | Freeze campaigns and funding actions until verified |

### 5.4 Independent State Dimensions

Review: draft, pending_review, changes_required, approved, rejected.
Funding: unfunded, pending, locked, settled.
Lifecycle: not_live, live, paused, closing, completed, cancelled, suspended.

A funded task can await review while its allocation remains locked. Publication requires approved sponsor, approved current task version and locked rewards. Cancellation/suspension is not settlement and cannot automatically release money.

## 6. Reward Economy Failure Cases

| Failure | Why It Is Dangerous | Required Control |
| --- | --- | --- |
| Signup bonus too high | Attracts farmers | Keep signup rewards low and mostly locked |
| Referral rewards too high | Drains launch pool | Reward active referrals only |
| Instant redemption | Fraud becomes profitable | Use redemption windows and manual review for first redemption |
| No outstanding liability tracking | Platform may owe more rewards than it can fund | Track approved points, locked points, pending points, and redeemable liability |
| Points created outside ledger | Balance becomes impossible to audit | Ledger-only point creation |
| Budget not reserved | Sponsor campaign may overspend | Lock at funded task creation; commit individual rewards at the task-specific promise step |
| No expiry rules | Old promo points become future debt | Expiry for promotional bonuses |
| No burn-rate dashboard | Admin discovers problems late | Daily reward pool and liability dashboard |

## 7. Nigeria and Africa Real-World Scenarios

| Scenario | Requirement |
| --- | --- |
| Poor network | Retry uploads, save drafts, compressed images |
| Low-end Android phones | Lightweight PWA, small bundle, fast screens |
| Expensive data | Avoid autoplay video and heavy assets |
| Users misunderstand points | Clear wallet labels and FAQ |
| Users expect instant cash | Clear redemption schedule and no cash-withdrawal language |
| Provider downtime | Queue reward requests, retry safely, show status |
| SIM or phone changes | Account recovery through verified channels |
| Distrust of earning apps | Transparent rules, support history, visible mission status |
| Users share phones | Device signal must not be the only fraud rule |
| Offline completion | Mission rules must define whether offline proof is acceptable |

## 8. Notification Failure Cases

| Scenario | Requirement |
| --- | --- |
| Push permission denied | In-app inbox and email fallback |
| Push delayed | Critical state must be visible in app |
| User opens app on another device | Notification state must sync server-side |
| Mission deadline reminder fails | Deadline must be visible on mission page |
| Email goes to spam | Important statuses must remain in app |
| Provider callback delayed | Redemption status must show processing, failed, or completed |

## 9. Support and Dispute Scenarios

Support must not be a generic chat box. Every support case should attach to real product records.

| Case | Required Data Link |
| --- | --- |
| Missing points | Mission submission and ledger entries |
| Failed redemption | Redemption request and provider transaction |
| Rejected mission appeal | Mission submission, proof, reviewer, rejection reason |
| Missing referral | Referral record and referred user status |
| Account flag complaint | Fraud flag and admin review notes |
| Sponsor dispute | Campaign, mission rules, submission evidence |

## 10. Admin Failure Scenarios

| Failure | Risk | Required Control |
| --- | --- | --- |
| Admin approves fake proof | Reward loss | Reversal flow and audit log |
| Admin reverses valid points | User trust loss | Reason required and appeal path |
| Admin edits balance directly | Ledger corruption | No direct balance edits |
| Reviewer backlog grows | Users churn | Review queue, priority, SLA dashboard |
| Pool not monitored | Reward budget burns out | Pool dashboard and alerts |
| Provider failures ignored | Many users complain | Provider status dashboard |
| Unauthorized admin access | Severe security risk | MFA, RBAC, audit logs |

## 11. Software Engineering Rules

### 11.1 General Code Rules

- Write clean, readable code.
- Avoid spaghetti code.
- Avoid god components, god services, and god modules.
- Keep functions small and purposeful.
- Use clear naming.
- Do not repeat business rules across unrelated files.
- Do not invent from scratch when a mature framework or library already solves the problem.
- Keep shared types, validation, and constants in predictable places.
- Prefer composition over large inheritance trees.
- Do not hide business rules inside UI components.
- Every important state transition must be explicit.

### 11.2 Search and Filtering Rules

- Search must be designed properly from the beginning.
- Admin and sponsor search must be server-side, paginated, sortable, and filterable.
- Do not load large datasets into the browser and filter locally.
- Search must support mission title, user, sponsor, status, date, reward amount, fraud flag, and provider status where relevant.
- Every list page must have empty state, loading state, error state, and pagination.

### 11.3 NestJS Rules

- Organize backend by domain modules.
- Controllers must stay thin.
- Services own business logic.
- Repositories own database access.
- Guards handle auth, roles, permissions, and ownership.
- Pipes handle validation and transformation.
- Filters handle consistent errors.
- Interceptors may handle response shaping, logging, and tracing where useful.
- DTOs must be used for request and response contracts.
- Jobs must handle email, push, fraud scans, and reward fulfillment.
- Provider integrations must sit behind interfaces.
- No hardcoded secrets, provider URLs, or API keys.

Recommended modules:

- `AuthModule`
- `UsersModule`
- `ProfilesModule`
- `MissionsModule`
- `SubmissionsModule`
- `WalletModule`
- `LedgerModule`
- `RewardsModule`
- `ReferralsModule`
- `SponsorsModule`
- `CampaignsModule`
- `NotificationsModule`
- `SupportModule`
- `FraudModule`
- `AdminModule`
- `AuditModule`

### 11.4 Next.js Rules

- Use App Router properly.
- Separate server components and client components.
- Use client components only where interaction is required.
- Do not put sensitive business logic in the frontend.
- Do not rely on frontend checks for security.
- Wallet, reward, and mission status must come from trusted backend APIs.
- Avoid putting every UI state in global state.
- Use local state for local UI, query cache for server state, and global state only where truly shared.
- Every page must handle loading, empty, error, and success states.
- Avoid stale cache for wallet, reward, redemption, and mission approval data.
- Build mobile-first.
- Keep bundle size controlled.

### 11.5 Auth Rules

- Use secure email and phone verification.
- Password reset tokens must expire.
- Login, signup, OTP, and password reset must be rate-limited.
- Admin accounts should require MFA.
- Role-based access control is mandatory.
- Ownership checks are mandatory.
- Sponsors must only access their campaigns.
- Users must only access their own wallet, submissions, redemptions, referrals, and support tickets.
- Admin actions must be logged.
- Sessions must be revocable.

### 11.6 Data and Ledger Rules

- Ledger is the source of truth.
- Wallet balance is derived from ledger entries.
- Ledger entries are append-only.
- Every ledger entry must have reason, source, reference, and actor where applicable.
- Reversals must be new ledger entries, not edits.
- Every financial-like operation must be idempotent.
- Full task allocation must lock at funded creation; task-specific commitments must precede promised work.
- Outstanding points liability must be visible to admin.
- Sponsor-funded task allocation must lock at funded creation, independently of review/publication.
- Sponsor budget reservations, consumption, refunds, and rollovers must be ledgered.

### 11.7 Provider Integration Rules

- Payment/redemption, Resend email, FCM push and R2 storage integrations must stay behind narrow interfaces. Introduce adapters with their consuming features; OneSignal is deferred. PostgreSQL uses Drizzle repositories, not a speculative universal database adapter. Follow [the agreed infrastructure decisions](INFRASTRUCTURE.md).
- Webhooks must verify signatures.
- Webhooks must be idempotent.
- Provider failures must not corrupt local state.
- Provider retries must not duplicate rewards.
- Provider transaction IDs must be stored.
- Every provider call must have timeout, retry policy, and failure state.

### 11.8 Testing Rules

Required tests:

- Ledger creation.
- Ledger reversal.
- Mission approval.
- Mission rejection.
- Referral milestones.
- Campaign budget reservation.
- Redemption request.
- Redemption retry.
- Provider webhook idempotency.
- Auth and role access.
- Sponsor ownership.
- Admin audit logs.
- Fraud flag creation.
- Search and filtering.
- Sponsor funding lock and campaign budget exhaustion.

Required test types:

- Unit tests for business services.
- Integration tests for APIs and database flows.
- E2E tests for critical user journeys.
- Security tests for auth and access control.
- Load tests for mission feed, submission, and redemption flows.

## 12. UI/UX Rules

- Every screen must explain itself without long lectures.
- Mission pages must show reward, steps, proof example, deadline, and rejection reasons.
- Wallet must separate pending, approved, locked, redeemed, reversed, and expired points.
- Redemption page must show eligibility before the user submits.
- Support should appear at the point of failure.
- Error messages must be human-readable.
- Empty states must guide the user to the next action.
- Admin pages must be dense, fast, searchable, and auditable.
- Sponsor pages must focus on campaign performance and spend.
- Avoid hype language that makes the product feel like gambling or fake earning apps.

## 13. Features To Delay

| Feature | Reason |
| --- | --- |
| Point transfer | High fraud and point black-market risk |
| Cash withdrawal | Higher compliance, liquidity, and fraud exposure |
| Fully automated approvals | Fraud patterns are unknown at launch |
| Sponsor self-publication without review | Lightweight self-service drafting/funding is allowed; every task still requires platform approval |
| High referral bonuses | Burns the launch pool quickly |
| Instant redemption | Fraud wins before review |
| Too many providers | Integration complexity before product proof |

## 14. Minimum Quality Bar Before Launch

PointRush should not launch until:

- Points ledger is working.
- Wallet states are clear.
- Mission proof review works.
- Redemptions have safe status handling.
- Admin can pause missions.
- Admin can pause redemptions.
- Admin can see reward pool balance.
- Admin can view suspicious users.
- Users can appeal rejected missions.
- Sponsors cannot publish missions without approval.
- Sponsor-funded missions cannot go live without locked campaign funds.
- Critical actions are logged.
- FAQs are visible.
- Mobile performance is acceptable.

## 15. Golden Rule

Every mission must be verifiable.  
Every point must be traceable.  
Every reward must be controlled.  
Every sponsor naira must be protected.  
Every user-facing rule must be clear.  
Every module must have one job.

## 16. Traceable Acceptance Scenarios

| Test ID | Rule | Scenario and expected result |
| --- | --- | --- |
| T-VAL-01 | VAL-01/02/03 | Local, international and formatted versions resolve to one canonical number. Invalid length/country/type is rejected. Equivalent verified numbers cannot own two accounts |
| T-VAL-02 | VAL-03/09 | Pending-number squatting, replayed/expired OTP, cross-purpose challenge and resend flood fail without permanently blocking the rightful owner |
| T-VAL-03 | VAL-04/05 | Eze and eze collide; boundary lengths 2/3/20/21, leading digit, trailing underscore, double underscore, Unicode lookalikes and reserved names produce specified outcomes |
| T-VAL-04 | VAL-04 | Concurrent claims of one available username result in exactly one account; loser receives recoverable conflict |
| T-VAL-05 | VAL-05/06 | Renamed username remains reserved; cooldown enforced; immutable referrals remain valid; legitimate Unicode display names work |
| T-AUTH-01 | Account gates | Bypass UI verification, spoof roles/badges, edit another sponsor task or read private proof: backend rejects |
| T-AUTH-02 | Account recovery | Recycled SIM cannot alone take over an account; number change reauthenticates and verifies; shared device alone does not ban a household |
| T-AUTH-03 | Restrictions | A risk signal alone does not freeze points; scoped restriction blocks only permitted actions and retains review/appeal history |
| T-FIN-01 | FIN-01 | Two task creations race for one balance: no overspend, no orphan lock, no published unfunded task |
| T-FIN-02 | FIN-01/02 | Retried funded creation or duplicated/out-of-order payment confirmation locks/credits once; mismatched amount/currency/reference rejected |
| T-FIN-03 | FIN-03 | Sponsor cannot withdraw, refund or allocate locked funds to another task; campaign aggregation cannot double-count them |
| T-TASK-01 | Selected assignment | 100 applicants for 2 positions: applications do not promise payment; concurrent selections cannot exceed 2 funded commitments |
| T-TASK-02 | Capped reward | Two users claim the last place: exactly one commitment; other gets clear unavailable state before work |
| T-TASK-03 | Open/time-bound | No universal slot restriction; fixed-reward promises remain budgeted; voluntary participation and date boundaries are explicit |
| T-TASK-04 | Terms/deadlines | Changed rules do not alter accepted work; server clock controls deadlines; timely submission remains protected when its claim expires |
| T-FIN-04 | FIN-04 | Concurrent approve/reject/refund/cancel commands preserve one valid transition and one point credit; stale reviewer sees conflict |
| T-FIN-05 | FIN-05 | Sponsor cancellation, silence or dispute cannot confiscate approved rewards or release pending appeal funds |
| T-FIN-06 | FIN-06 | Budget decrease cannot consume commitments; increase requires funding; provider chargeback stops new exposure without silent point seizure |
| T-CODE-01 | VAL-14/15 | Business codes are centrally assigned and distinct; two businesses cannot receive the same business code; renaming a business does not break historical codes |
| T-CODE-02 | VAL-15/16 | Generated claim codes remain globally unique across businesses and campaigns; formatted/lowercase manual input resolves correctly; invalid guesses are rate-limited |
| T-CODE-03 | VAL-17/FIN-07 | Two simultaneous submissions of one unused code produce one claim and one ledger/fulfilment record; retry returns the original result |
| T-CODE-04 | PRD 13.1 | Opening a page or scanning a reusable discovery QR does not award or consume anything; printed-code-only campaigns work without QR |
| T-CODE-05 | FIN-07 | Code batch activation allocates locked task funds once; unclaimed expiry and authorised cancellation release only eligible unused backing |
| T-CODE-06 | PRD 13.1 | Different batches resolve to different points/rewards; the client cannot alter a code's reward; claimed/expired/cancelled codes cannot be reactivated |
| T-CODE-07 | PRD 13.1 | Raw code exports are access-controlled, audited and excluded from logs/analytics; claim links do not expose unnecessary private data |
| T-REV-01 | Review policy | Missed review target escalates; correction and appeal deadlines enforced; no automatic approval/rejection for sponsor silence |
| T-REV-02 | Permissions | Sponsor cannot decide own appeal or approve own submitted work; prohibited transitions and cross-tenant bulk requests fail |
| T-RED-01 | Redemption | Duplicate submit, lost response and provider timeout never trigger blind second fulfillment; first-redemption gate and caps checked atomically |
| T-VER-01 | VER-01/02 | Paid subscription, tier, email verification and sponsor approval never manufacture public badges |
| T-VER-02 | VER-03/04 | Expired/revoked badge is not displayed as current; ownership changes trigger recheck; private evidence inaccessible to sponsors/public |
| T-UX-01 | UX contract | Inline errors, summary/focus, paste/autofill, keyboard/mobile, long values, screen-reader feedback and preserved drafts work consistently |
| T-UX-02 | Search/recovery | Late search response cannot overwrite new results; tenant filters remain enforced; session expiry and reconnect preserve safe work |
| T-POOL-01 | PRD 8.3 | NGN 75,000 issuance allocation and NGN 25,000 reserve are not double-spent; issued points stay backed and redemption does not refill issuance allowance |
| T-UPLOAD-01 | VAL-12/13 | Oversized/disguised/private uploads and internal-network proof URLs cannot bypass file access or SSRF controls |

Use actual database concurrency tests for financial and uniqueness cases, API permission tests for ownership, and browser tests for UX. Run shared-pool and public-badge scenarios when those later features are enabled; test that disabled features cannot be invoked beforehand.

## 17. Unresolved Policy Gates

The validation specification lists policy decisions still required before their workflows ship. Age eligibility is deferred. A test expecting an unspecified OTP expiry, fee refund, shared-pool formula or review deadline is not an approved requirement. Agree and version those policies, then bind acceptance assertions to them. Proposed review targets do not constitute an implemented or staffed service guarantee.

## 18. Sponsor Onboarding, Reputation and Identity Acceptance Cases

| Test ID | Requirement | Expected result |
| --- | --- | --- |
| T-SP-01 | Lightweight launch onboarding | Sponsor can onboard with verified email, name, contact and task details without NIN/BVN/selfie/CAC checks; identity badge remains absent |
| T-SP-02 | Universal task approval | New, established and identity-verified sponsors cannot publish any task version without explicit platform approval; direct API and bulk bypass attempts fail |
| T-SP-03 | Funding is not identity | Paid and locked funds never grant an identity badge or approve destination links; funded harmful tasks are rejected |
| T-SP-04 | Changed task terms | Material edits require reapproval; existing accepted terms and commitments remain protected |
| T-REP-01 | REP-01/02 | New is distinct from misconduct; funding volume, points, paid membership or referrals cannot purchase reputation |
| T-REP-02 | REP-03 | Non-participants and duplicate ratings rejected; mutual-feedback timing enforced; upheld appeal corrects reputation |
| T-REP-03 | REP-04 | Repeated counterparties and reciprocal task farms cannot manufacture trust merely through volume |
| T-REP-04 | REP-05 | Highest reputation cannot bypass funding, task approval, proof or permission controls |
| T-REP-05 | REP-06 | Identity verification can coexist with New reputation; high reputation cannot imply identity verification |

Reputation thresholds and identity-provider triggers remain open. Do not turn earlier illustrative scores, suggested providers or prices into configured production rules. Age eligibility is deferred; this documentation update approves neither an age gate nor unrestricted eligibility.
