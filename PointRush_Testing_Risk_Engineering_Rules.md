# PointRush Testing, Risk, and Engineering Rules

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

1. Sponsor creates campaign draft.
2. Sponsor defines mission reward, target number of approvals, total campaign budget, platform fee, and campaign duration.
3. Platform calculates total funding required.
4. Sponsor pays using the selected payment provider.
5. Payment is verified through a signed provider webhook.
6. Confirmed campaign budget becomes locked against that campaign.
7. Campaign can only go live after admin approval and confirmed funding.
8. Approved submissions consume locked budget.
9. Pending submissions reserve budget if needed.
10. Unused budget is refunded, rolled over, or converted to sponsor credit based on campaign terms.

### 5.2 Sponsor Budget Rules

- Sponsor reward budget must be separated from founder-funded launch rewards.
- Campaign must pause automatically when remaining budget cannot cover another approval.
- Platform fees must be shown separately from user reward budget.
- Approved user rewards cannot be reversed because a sponsor changed their mind.
- Sponsor refunds must exclude already approved rewards and non-refundable platform fees unless platform policy says otherwise.
- Every funding, reservation, approval, refund, and rollover must have ledger records.
- Sponsor budget state must be visible to admin.

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
| Budget cannot cover pending submissions | Stop new joins and prioritize already joined users based on campaign rules |
| Sponsor claims fraud after approvals | Investigate; reverse only proven fraudulent rewards |
| Sponsor asks for refund after approved work | Do not refund approved user rewards unless fraud is proven |
| Sponsor mission violates policy | Reject or suspend campaign |
| Sponsor account is compromised | Freeze campaigns and funding actions until verified |

### 5.4 Campaign State Machine

Campaign states must be explicit:

- `draft`
- `pending_review`
- `changes_required`
- `pending_funding`
- `funded`
- `live`
- `paused`
- `closing`
- `completed`
- `settled`
- `cancelled`
- `suspended`

No campaign should jump from `draft` to `live`. The minimum safe path is:

`draft -> pending_review -> pending_funding -> funded -> live`

## 6. Reward Economy Failure Cases

| Failure | Why It Is Dangerous | Required Control |
| --- | --- | --- |
| Signup bonus too high | Attracts farmers | Keep signup rewards low and mostly locked |
| Referral rewards too high | Drains launch pool | Reward active referrals only |
| Instant redemption | Fraud becomes profitable | Use redemption windows and manual review for first redemption |
| No outstanding liability tracking | Platform may owe more rewards than it can fund | Track approved points, locked points, pending points, and redeemable liability |
| Points created outside ledger | Balance becomes impossible to audit | Ledger-only point creation |
| Budget not reserved | Sponsor campaign may overspend | Reserve budget before accepting submissions |
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
- Campaign budget must be reserved before user rewards are approved.
- Outstanding points liability must be visible to admin.
- Sponsor-funded campaign budget must be locked before campaign launch.
- Sponsor budget reservations, consumption, refunds, and rollovers must be ledgered.

### 11.7 Provider Integration Rules

- Paystack, Nomba, Resend, OneSignal, object storage, and database-specific logic must be behind service interfaces.
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
| Open sponsor self-service | Bad campaigns can damage trust |
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
