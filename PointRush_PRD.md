# PointRush Product Requirements Document

## Document Map

- [Validation and approval rules](PointRush_Validation_Approval_Rules.md): field constraints, task models, funding commitments, review permissions and later verification badges.
- [Testing and engineering rules](PointRush_Testing_Risk_Engineering_Rules.md): abuse cases and traceable acceptance scenarios.
- [Design direction](DESIGN.md): components, colours, typography and branding.
- [UX contract](UX-CONTRACT.md): forms, search, feedback and recovery.

Task means an individual mission; a campaign may contain multiple tasks. Funding belongs to explicit task allocations and must never be counted twice at campaign level. Rules marked proposed remain planning defaults until resolved before launch.

## 1. Product Summary

**Working name:** PointRush  
**Tagline:** Complete missions. Earn points. Redeem rewards.

PointRush is a gamified earning and rewards platform where users complete verified missions, earn points, rise through trust-based tiers, and redeem points for airtime, data, subscriptions, vouchers, discounts, and other rewards.

For sponsors, brands, creators, businesses, and opportunity owners, PointRush is a way to fund verified actions instead of paying for empty attention. They can launch campaigns, define mission rules, fund reward pools, review submissions, and track real outcomes.

The platform must feel simple, interactive, and money-connected from day one, but it must not become gambling, betting, forex, prediction, or luck-based earning.

## 2. Core Insight

Many people are constantly looking for ways to earn money, especially in markets where income is unstable, jobs are scarce, and online opportunities feel confusing or unreliable. Betting, crypto, forex, tap-to-earn, and referral apps attract people because they offer:

- A visible path to earning.
- Small actions with immediate feedback.
- Progress bars, balances, ranks, and streaks.
- Hope of moving from small wins to bigger rewards.
- Social proof that “people like me are earning.”

PointRush should borrow the psychology of progress, status, missions, and rewards without copying the harmful parts of gambling, prediction markets, or financial speculation.

## 3. Product Goals

- Help users discover legitimate earning opportunities through verified tasks.
- Make earning feel interactive, guided, and game-like without relying on luck.
- Give businesses and sponsors measurable outcomes from funded campaigns.
- Build a controlled points economy that does not burn the founder’s reward pool.
- Create a platform where the admin can earn from day one through sponsor fees, campaign setup fees, margins, and promoted missions.
- Establish trust through transparent rules, FAQs, proof review, fraud controls, and redemption clarity.

## 4. Non-Goals

- PointRush is not a betting platform.
- PointRush is not a forex, crypto, or prediction app.
- PointRush is not an app testing marketplace.
- PointRush is not a product review platform.
- PointRush is not a cash wallet at launch.
- PointRush is not promising users income, employment, or guaranteed profit.

## 5. Target Users

### 5.1 Earners

People who want practical ways to earn small rewards online.

Examples:

- Students.
- Job seekers.
- Young people with smartphones.
- Micro-creators.
- Social media users.
- People looking for airtime, data, and small digital rewards.

### 5.2 Creators and Influencers

People with audiences who want access to brand missions, content campaigns, referrals, affiliate opportunities, and verified creator status.

### 5.3 Sponsors and Businesses

People or companies that want verified actions from real users.

Examples:

- Brands.
- SMEs.
- Course sellers.
- Event organizers.
- SaaS startups.
- Recruiters.
- Local businesses.
- Creators launching paid communities or products.

### 5.4 Platform Admins

The internal team controlling missions, sponsor approvals, user verification, fraud checks, redemptions, support, analytics, and reward pool limits.

## 6. Core Product Loop

1. User signs up.
2. User completes profile and interests.
3. User sees available missions.
4. User joins a mission.
5. User completes the required action.
6. User submits proof.
7. Submission is reviewed by rules, AI checks, or admin.
8. Approved user earns points.
9. Approved points increase wallet balance; settled conduct contributes separately to reputation.
10. User redeems points for rewards.
11. User refers others or unlocks better missions.
12. Sponsors fund more missions when they see verified outcomes.

## 7. Product Principles

- **Clarity beats hype:** Users must understand how to earn, how points work, and why a mission was accepted or rejected.
- **Progress must be visible:** Every user should see wallet balance, pending points, tier progress, mission status, and redemption eligibility.
- **No luck-based earning:** Rewards must come from verified action, not chance.
- **Reward pool must be protected:** Points, bonuses, referrals, and redemptions must be capped.
- **Trust unlocks value:** Better users get better missions, higher redemption limits, and faster review.
- **Sponsors pay for proof:** Campaign value comes from verified action, analytics, and quality control.
- **Admin control is mandatory:** Every money-related feature must have limits, logs, and manual override.

## 8. Launch Reward Economy

### 8.1 Starting Reward Pool

Initial founder-funded reward pool: **₦100,000**

This pool should not be treated as free money for all users. It should be used to create traction, prove behavior, build trust, and attract sponsors.

### 8.2 Points Conversion

Recommended launch conversion:

| Points | Reward Value |
| ---: | ---: |
| 1,000 points | ₦100 |
| 3,000 points | ₦300 |
| 5,000 points | ₦500 |
| 10,000 points | ₦1,000 |

Total theoretical equivalent of the pool (not the initial issuance allowance):

| Reward Pool | Point Equivalent |
| ---: | ---: |
| ₦100,000 | 1,000,000 points |

### 8.3 Pool Allocation

| Allocation | Amount | Purpose |
| --- | ---: | --- |
| Onboarding rewards | ₦10,000 | Profile completion and first approved mission incentives |
| Daily missions | ₦35,000 | Main earning activity |
| Referral rewards | ₦20,000 | Reward only active, verified referrals |
| Tier unlock bonuses | ₦10,000 | Bronze, Silver, Gold progression |
| Redemption reserve | ₦15,000 | Prevent failed reward fulfillment |
| Fraud/error buffer | ₦10,000 | Mistakes, reversals, provider failures |

Under this allocation, NGN 75,000 (750,000 points at the proposed rate) funds initial reward issuance; NGN 25,000 remains ring-fenced. Issued points retain their backing until redeemed or legitimately reversed. Redemption does not create new issuance capacity by itself. Provider costs must be budgeted separately; buffer reallocation requires an audited decision and a solvency check.

### 8.4 Redemption Rules

- Minimum redemption: **3,000 points = ₦300**.
- No instant redemption for new users.
- Redemption eligibility requires:
  - Verified email and phone ownership; a public verification badge is not required.
  - At least 2 approved missions.
  - No active restriction applicable to redemption; a risk signal alone is not a restriction.
  - Minimum point threshold reached.
- Launch redemptions should happen in controlled windows, for example weekly.
- Admin can pause redemptions if fraud, provider failure, or pool limits require it.

### 8.5 Point States

| State | Meaning |
| --- | --- |
| Pending | User submitted proof, but points are not approved yet |
| Approved | Points added to available balance |
| Locked | Points earned but not yet redeemable due to tier, fraud, or timing rules |
| Redeemed | Points exchanged for reward |
| Reversed | Compensating ledger entry after substantiated fraud or a confirmed erroneous credit; sponsor disagreement alone is insufficient |
| Expired | Promotional points not used within their validity period |

## 9. Referral System

Referral rewards must be based on active behavior, not empty signups.

| Referral Event | Reward |
| --- | ---: |
| Friend signs up | 0 points |
| Friend verifies account | 100 points |
| Friend completes first approved mission | 300 points |
| Friend completes 3 approved missions | 700 points |
| Maximum per qualified referral | 1,100 points |

Referral abuse controls:

- Device fingerprinting.
- Phone/email verification.
- Duplicate bank/phone/reward destination checks.
- IP and location anomaly checks.
- Maximum referral rewards per day.
- Manual review for referral clusters.

## 10. Tier System

Users and sponsors both earn public reputation levels from their conduct over time. New accounts start as **New**, not untrusted. Identity/business verification is a separate check and label.

| Subject | Evidence of trust |
| --- | --- |
| User | Valid original work, reliable completion, fair interaction, low substantiated spam/fraud and resolved disputes |
| Sponsor | Legitimate completed tasks, fair timely reviews, funded rewards, participant satisfaction and resolved complaints |

- Count completed, settled activity, not task creation, applications or joins.
- Points balance, spending, paid membership and referral counts do not buy or determine trust.
- Feedback is restricted to actual eligible interactions, once per interaction. Publish mutual feedback after both parties submit or the feedback window ends to reduce retaliation.
- Use upheld complaints and appeal outcomes, not raw accusations. Correct reputation when an appeal changes the underlying decision.
- Limit the influence of repeated interactions with the same small group; assess sustained activity across distinct counterparties and recent behaviour.
- Higher reputation may unlock opportunities, higher configured limits and less routine submission review. It never bypasses platform task approval, proof, permissions or funding locks.
- Keep private fraud controls separate from the public reputation summary. A level does not guarantee honesty.
- Exact level names, thresholds, rating window, sample-size requirements and redemption-cap mapping remain open. Earlier points/referral-based qualification tables are superseded; no replacement numerical thresholds are approved yet.

## 11. Mission Types

### 11.1 Launch Mission Types

- Follow or engage with a verified page.
- Join a community.
- Share approved campaign content.
- Submit user-generated content.
- Refer qualified users.
- Attend online or offline events.
- Complete educational modules.
- Apply for selected opportunities.
- Complete creator or job-seeker profile.
- Participate in brand awareness campaigns.

### 11.2 Later Mission Types

- Affiliate sales missions.
- Lead generation missions.
- Local merchant promotions.
- Campus ambassador missions.
- Verified content creator campaigns.
- Sponsored learning paths.
- Job readiness challenges.
- Partner loyalty campaigns.

### 11.3 Participation and Reward Models

- Selected assignments: many can apply; one, two, or another configured number are selected. Fixed rewards are committed on selection, before work starts.
- Capped fixed-reward missions: rewards are committed when eligible users claim a funded place, with a disclosed completion deadline.
- Time-bound campaigns: dates constrain participation, while the chosen reward model independently constrains spending.
- Open campaigns: potentially unlimited participation, with explicit separation between rewarded and voluntary participation. An unfunded participant must never see a guaranteed reward promise.
- Shared-pool campaigns: planned alternative with disclosed variable rewards. Formula, rounding, minimum payouts and cancellation rules must be specified before enabling.

Joining is not universally a reservation. The platform reserves funds when it commits to a reward under the accepted task rules. Publication must specify participation, selection, reward, timing, funding and repeatability settings.

## 12. Sponsor Model

Sponsors fund missions by defining:

- Campaign objective.
- Target user segment.
- Mission requirements.
- Reward per approved action.
- Budget.
- Proof type.
- Review rules.
- Campaign duration.

### 12.1 Sponsor Revenue Options

| Revenue Type | Example |
| --- | --- |
| Campaign setup fee | Sponsor pays ₦5,000 to create a campaign |
| Platform margin | Sponsor pays ₦150 per approved action, user receives ₦100 value |
| Promoted mission fee | Sponsor pays to feature campaign higher in feed |
| Monthly sponsor subscription | Brands pay for analytics, campaign tools, and verified creator access |
| Managed campaign fee | Platform helps design and run campaign |
| Redemption partner margin | Platform earns small margin on airtime/data/voucher fulfilment |

### 12.2 Day-One Earning Strategy for Admin

From day one, the platform should avoid relying only on user growth. Admin should earn from:

- Charging early sponsors campaign setup fees.
- Taking a margin between sponsor-funded reward value and user reward value.
- Selling featured mission placement.
- Offering managed campaign support.
- Building verified creator/job-seeker segments sponsors can pay to reach.

### 12.3 Sponsor Funding and Reward Locking

Sponsor reward funds allocated to a task must lock atomically when that funded task is created. Unfunded drafts are allowed but cannot publish or accept participants.

1. Sponsor defines the task model, terms, reward budget and separate platform fees.
2. Confirmed available sponsor funds are checked server-side. Provider confirmation must match the account, reference, amount and currency; browser success is not proof.
3. Funded task creation and budget locking happen in one transaction. Insufficient funding leaves an unfunded draft or fails the funded-creation operation.
4. Locked funds cannot fund another task, be withdrawn, refunded or rolled over while committed.
5. Active sponsor access, platform approval of the current task version and locked funding are independent publication gates. Mandatory sponsor ID/business-document verification is not a launch gate.
6. Reward commitments are recorded within the locked allocation according to the task model, not automatically on every Join.
7. Approval atomically converts a commitment into backing for earned points and credits the user's ledger exactly once.
8. Rejection cannot release disputed funds before correction/appeal rights finish.
9. Cancellation stops new commitments and protects accepted work. Only unused, uncommitted funds can be released through settlement.

For example, NGN 50,000 available minus a NGN 20,000 task allocation leaves NGN 30,000 available. If NGN 5,000 backs approved rewards and NGN 3,000 backs ongoing work, NGN 12,000 remains uncommitted but locked to the task.

Admin must separately see available sponsor funds, task-locked uncommitted funds, participant commitments, approved reward backing, fees and authorised releases. Campaign totals aggregate task allocations; they do not create another balance. A ledger lock is not a guarantee against provider chargebacks or a claim of legal escrow.

### 12.4 Sponsor Edge Case Solutions

| Scenario | Solution |
| --- | --- |
| Sponsor creates campaign but does not pay | Campaign remains draft and invisible to users |
| Sponsor payment succeeds but webhook is delayed | Campaign stays in pending funding until payment is verified |
| Sponsor funds less than required | Campaign cannot launch until the shortfall is paid or campaign size is reduced |
| Sponsor funds campaign, then cancels before launch | Refund or sponsor credit after platform fee rules are applied |
| Sponsor cancels after users have joined | Enter closing; preserve accepted terms, committed work, pending reviews and appeals; no blanket forfeiture |
| Sponsor rejects valid submissions unfairly | Admin arbitration decides using mission rules and submitted proof |
| Sponsor runs out of campaign budget | Stop new reward commitments before overspending; open voluntary participation may continue only if clearly disclosed |
| Sponsor changes mission reward mid-campaign | Change applies only to future participants, not existing joined users |
| Sponsor changes proof rules mid-campaign | Change applies only to future participants |
| Sponsor disputes after campaign ends | Platform uses stored campaign rules, submission proof, and audit logs |
| Sponsor requests refund after approved work | Approved rewards remain backed; unused funds and fees follow disclosed refund terms; disputes require investigation |
| Sponsor uploads harmful campaign | Admin rejects campaign before it goes live |
| Sponsor wants guaranteed sales | Platform must clarify that campaigns buy verified actions, not guaranteed revenue |

### 12.5 Sponsor Campaign States

| State | Meaning |
| --- | --- |
| Draft | Sponsor is still creating the campaign |
| Pending Review | Campaign submitted for admin review |
| Changes Required | Admin rejected or requested edits |
| Pending Funding | Draft awaits confirmed funding; cannot publish |
| Funded | Task allocation locked at funded creation; approval is still required |
| Live | Users can join and complete mission |
| Paused | Campaign temporarily stopped by sponsor, admin, or budget rule |
| Closing | Campaign is ending, but existing joined users may still submit within rules |
| Completed | Campaign ended and no new actions are accepted |
| Settled | Rewards, fees, refunds, and sponsor reports are finalized |

Funding and review are separate state dimensions. A funded task may be pending review or require changes without releasing its allocation. Publication requires both gates; cancellation/suspension never bypass settlement.

## 13. Reward Marketplace

Launch rewards:

- Airtime.
- Mobile data.
- Subscription vouchers.
- Gift cards or merchant vouchers where available.

Later rewards:

- Course discounts.
- Event tickets.
- Partner coupons.
- Creator tools.
- Sponsored benefits.
- Financial service perks.

Important launch rule: **No cash withdrawal initially.** This reduces fraud, regulatory complexity, and pressure on liquidity.

## 14. User Features

- Account creation and login.
- Profile setup.
- Interest selection.
- Mission feed.
- Mission detail page.
- Join mission.
- Submit proof.
- Submission status tracking.
- Points wallet.
- Pending, approved, locked, redeemed, reversed point history.
- Tier progress.
- Referral link and referral progress.
- Reward marketplace.
- Redemption request.
- Redemption history.
- In-app notification center.
- Push/email notifications.
- Support ticket creation.
- FAQs and help center.
- Rules and trust score explanation.

## 15. Sponsor Features

- Sponsor onboarding.
- Lightweight onboarding: verified email, sponsor name, contact details and task information; no mandatory sponsor identity/business-document checks at launch.
- Earned sponsor reputation and later separate identity/business verification.
- Campaign creation.
- Campaign funding.
- Mission setup.
- Targeting by user tier, location, interest, or creator type.
- Submission review.
- Approval/rejection actions.
- Campaign analytics.
- Export campaign results.
- Fraud report.
- Invoice/payment history.
- Support tickets.

## 16. Admin Features

- User management.
- Sponsor management.
- Mission management.
- Campaign approval.
- Proof review.
- Points ledger monitoring.
- Redemption approval.
- Reward provider monitoring.
- Fraud flags.
- Referral abuse detection.
- Support ticket dashboard.
- FAQ/content management.
- Notification broadcast.
- Analytics dashboard.
- Audit logs.
- Manual point adjustment with reason.
- Pool and campaign budget controls.

## 17. Analytics Requirements

### 17.1 User Analytics

- Points earned.
- Points pending.
- Points redeemed.
- Missions completed.
- Approval rate.
- Tier progress.
- Referral progress.
- Redemption eligibility.

### 17.2 Sponsor Analytics

- Mission views.
- Mission joins.
- Submissions.
- Approved submissions.
- Rejected submissions.
- Cost per approved action.
- User segments.
- Top performers.
- Fraud flags.
- Campaign budget spent.
- Campaign budget remaining.

### 17.3 Admin Analytics

- Daily active users.
- Weekly active users.
- New signups.
- Mission completion rate.
- Total points issued.
- Total points redeemed.
- Outstanding point liability.
- Reward pool remaining.
- Sponsor revenue.
- Campaign profitability.
- Fraud attempts.
- Redemption failures.
- Support ticket volume.

## 18. Notifications

Notification is a core feature, not optional.

Required notification types:

- Welcome message.
- Email verification.
- Password reset.
- Mission joined.
- Proof submitted.
- Mission approved.
- Mission rejected.
- Points credited.
- Tier upgraded.
- Redemption submitted.
- Redemption completed.
- Redemption failed.
- New mission available.
- Referral milestone.
- Support ticket reply.

Channels:

- In-app notification center.
- Web/PWA push notifications.
- Email fallback.
- SMS or WhatsApp later only if cost and API limitations make sense.

## 19. Customer Support

Support must be built around the actual product records.

Users should be able to open tickets for:

- Mission rejection.
- Missing points.
- Redemption failure.
- Referral issue.
- Account verification issue.
- Suspicious account activity.
- General question.

Support tickets should link to:

- User account.
- Mission submission.
- Points ledger entry.
- Redemption request.
- Referral record.
- Admin actions.

## 20. User FAQs

### What is PointRush?

PointRush is a platform where you complete verified missions, earn points, and redeem those points for rewards like airtime, data, subscriptions, vouchers, and partner offers.

### Is PointRush betting or gambling?

No. PointRush is not betting, gambling, forex, crypto, or prediction. You earn points by completing verified actions, not by luck or risk.

### How do I earn points?

You earn points by completing missions and submitting valid proof. Points are added after your submission is approved.

### Are points the same as cash?

No. Points are reward credits inside PointRush. They can be redeemed for supported rewards when you meet the redemption rules.

### Can I withdraw cash?

Not at launch. The first rewards will focus on airtime, data, subscriptions, vouchers, discounts, and partner benefits.

### Why are my points pending?

Your points remain pending while your proof is being reviewed. If the proof is accepted, the points become approved. If it fails the rules, the mission is rejected.

### Why was my mission rejected?

A mission may be rejected if the proof is unclear, fake, duplicated, submitted late, does not follow instructions, or violates platform rules.

### When can I redeem?

You can redeem when you have verified email and phone ownership, sufficient available points, the required approved missions, remaining redemption allowance, an open redemption window and no applicable active restriction. A public verification badge is not required.

### What is the minimum redemption?

The recommended launch minimum is 3,000 points, equal to ₦300 reward value.

### How do referrals work?

You earn referral points only when the person you invited verifies their account and completes approved missions. Empty signups do not earn meaningful rewards.

### What are tiers?

Tiers show your trust level and progress. Higher tiers unlock better missions, higher redemption limits, faster review, and more opportunities.

### Can I transfer points to another user?

Point transfer is planned, but it should not launch until fraud controls are strong enough. When enabled, transfers will have limits and monitoring.

### What happens if my redemption fails?

If a redemption fails, your request will be reviewed. The points may be returned or the reward may be retried depending on the reason for failure.

### Can I lose points?

Yes. Points can be reversed if they were earned through fake proof, duplicate accounts, fraud, or abuse.

### How do I know missions are real?

Every task, including platform-created tasks, requires platform review and approval of its current version before publication. Sponsor reputation or verification status never bypasses this gate. Allocated reward funding locks at funded task creation. Mandatory sponsor ID verification is not required at launch.

### Does joining always guarantee a reward?

No. Each task states whether you are applying for selection, claiming a funded place, joining voluntarily or participating in a variable reward pool. A fixed reward commitment is made only at the step disclosed in that task's terms.

### Can a sponsor take back my approved reward?

A sponsor changing their mind does not reverse valid earnings. Fraud or erroneous credits require evidence and an audited correction process.

### What does a verified badge mean?

Later badges identify the checks PointRush performed on identity, business representation or linked profile ownership. They are separate from contact verification, tiers and campaign approval; they do not guarantee honesty, earnings or endorsement.

## 21. Technical Architecture

### 21.1 Recommended Stack

| Layer | Recommendation |
| --- | --- |
| Frontend | Next.js, TypeScript, PWA |
| Backend API | NestJS |
| Database | Postgres |
| ORM | Prisma or Drizzle |
| Cache/rate limits/queues | Upstash Redis or Google Cloud Tasks/Pub/Sub |
| File storage | Cloudflare R2 or Google Cloud Storage |
| Email | Resend first, Brevo later for marketing automation |
| Push notifications | OneSignal first, FCM later if native mobile is added |
| Payments | Paystack for sponsor payments |
| Rewards | Nomba first for airtime/data/bills if API access is approved |
| Deployment | Vercel for frontend, Google Cloud Run for NestJS API |
| Analytics | PostHog or self-hosted event table first |
| Error monitoring | Sentry |

### 21.2 Portability Rule

The platform may move from Supabase later, so the backend must avoid deep provider lock-in.

Rules:

- Keep business logic inside NestJS services.
- Use a database abstraction through Prisma or Drizzle.
- Do not depend heavily on Supabase Auth, Supabase Storage, or Supabase Edge Functions.
- Keep provider integrations behind service interfaces.
- Store files in a portable object storage provider.

## 22. Key Data Objects

- User.
- User profile.
- Sponsor.
- Campaign.
- Mission.
- Mission submission.
- Proof file.
- Points ledger entry.
- Wallet summary.
- Referral.
- Tier.
- Redemption request.
- Reward provider transaction.
- Notification.
- Support ticket.
- Audit log.
- Fraud flag.
- Admin action.

## 23. Security and Fraud Requirements

Mandatory controls:

- Immutable points ledger.
- Idempotent payment and redemption operations.
- Webhook signature verification.
- Role-based admin access.
- Admin audit logs.
- Rate limiting.
- Duplicate account detection.
- Device and IP risk signals.
- Suspicious referral cluster detection.
- Manual review queues.
- Reward pool caps.
- Campaign budget caps.
- Redemption caps by tier.
- Provider failure handling.
- No direct database balance edits without ledger entry and audit reason.

## 24. Testing, Abuse Cases, and Engineering Standards

PointRush must be designed as if users, sponsors, providers, and even internal admins can make mistakes or abuse the system. The product must not rely on trust alone.

### 24.1 Critical Abuse Cases

- Users creating multiple accounts to farm signup, referral, and mission rewards.
- Referral rings where users coordinate in WhatsApp or Telegram groups.
- Reused, edited, or old screenshots submitted as proof.
- Users completing social missions, earning points, then undoing the action.
- Bots or scripts submitting low-quality tasks at high speed.
- Users pressuring support with false claims after rejected missions.
- Sponsors rejecting valid submissions to save money.
- Sponsors creating unclear, spammy, illegal, or impossible missions.
- Reward providers failing after points have already been deducted.
- Admins approving, reversing, or adjusting points incorrectly.

### 24.2 Non-Negotiable Engineering Rules

- Use a proper points ledger. Wallet balance must never be the source of truth.
- Every payment, redemption, webhook, reward, and point approval must be idempotent.
- Business logic belongs in backend services, not frontend screens or controllers.
- Do not repeat business rules across multiple places.
- Avoid god components, god services, and tangled modules.
- Use reusable UI primitives, shared validation, and clean domain boundaries.
- Do not invent custom framework patterns when Next.js and NestJS already provide stable conventions.
- Validate all inputs on the backend.
- Enforce authentication, authorization, role checks, and ownership checks on every protected endpoint.
- Use server-side search, filtering, and pagination for admin and sponsor data.
- Keep Paystack, Nomba, Resend, OneSignal, storage, and database access behind provider interfaces.
- Log important business events and admin actions.
- Separate staging and production from day one.
- Write tests for ledger, referrals, redemptions, campaign budgets, auth, and mission approval.

### 24.3 UX Failure Rules

- Every screen must handle loading, empty, success, error, and blocked states.
- Users must always see why points are pending, locked, approved, rejected, redeemed, reversed, or expired.
- Mission pages must show reward value, task steps, deadline, proof example, and rejection reasons.
- Redemption pages must show eligibility before the user attempts redemption.
- Support flows must connect to the actual mission, ledger, redemption, or referral record.
- The app must be usable on low-end Android phones and weak networks.

Detailed breakage scenarios and engineering rules are maintained in the dedicated testing and architecture rules document.

## 25. Launch Plan

### Phase 1: Private Launch

Goal: prove that users understand missions, points, proof, tiers, and redemptions.

Recommended size:

- 100 to 300 users.
- ₦100,000 reward pool.
- 5 to 10 mission types.
- Airtime/data rewards only.
- Manual or semi-manual proof review.
- Weekly redemption windows.

### Phase 2: Early Sponsors

Goal: reduce founder-funded rewards by adding sponsor-funded campaigns.

Actions:

- Recruit small businesses, creators, course sellers, and event organizers.
- Charge campaign setup fee.
- Run campaigns with controlled budgets.
- Give sponsors simple analytics.
- Keep platform margin on approved actions.

### Phase 3: Campaign Marketplace

Goal: make sponsors the main source of reward pool funding.

Actions:

- Sponsor dashboard.
- Campaign funding wallet.
- Automated mission approval rules.
- Creator and user segmentation.
- Better fraud scoring.
- Promoted missions.

### Phase 4: Rewards and Loyalty Network

Goal: make PointRush more like a loyalty economy.

Actions:

- Add partners.
- Add discounts and sponsored benefits.
- Add larger reward pools.
- Add transfer limits if fraud controls are mature.
- Expand analytics and sponsor subscriptions.

## 26. Open Decisions

- Final product name.
- Exact points-to-naira conversion at launch.
- Whether first launch should be invite-only.
- Whether redemptions happen weekly or twice weekly.
- Whether to start with Nomba immediately or manually fulfill airtime/data while API access is being secured.
- Public verified sponsor/user/creator badges are a later feature; exact evidence requirements, expiry and retention remain to be decided.
- Contact recovery, verification-message provider/cost, first-redemption waiting period and restriction review deadlines. Age eligibility is intentionally deferred and is not a launch policy decision in this specification.
- Review/correction/appeal timings proposed in the validation specification.
- Shared-pool allocation and rounding policy before that model is enabled.
- Fee refund terms, chargeback response and behaviour-based reputation thresholds for users and sponsors.
- Exact sponsor setup fee.
- Exact admin margin per sponsor-funded mission.
- Whether to use Prisma or Drizzle.
- Whether to start with Supabase Postgres, Neon, or Cloud SQL.

## 26.1 Identity Verification and Reputation

Verified sponsor and verified user/creator badges are later features, independent of contact ownership and reputation. Record subject, scope, status, reviewer, evidence reference and verification date. Expiry, revocation, re-verification after ownership changes and appeals must be supported. Sponsors see verification results, not private identity evidence. Paid membership, account approval or a high tier never automatically grants a badge. Badges never bypass task approval, funding or proof requirements.

## 27. Success Metrics

### User Metrics

- Signup-to-first-mission rate.
- First mission approval rate.
- Day 1 retention.
- Day 7 retention.
- Missions completed per active user.
- Referral activation rate.
- Redemption completion rate.

### Sponsor Metrics

- Campaign creation rate.
- Campaign funding rate.
- Cost per approved action.
- Repeat sponsor rate.
- Sponsor satisfaction.

### Platform Metrics

- Reward pool burn rate.
- Sponsor revenue.
- Gross margin per campaign.
- Outstanding points liability.
- Fraud rate.
- Support ticket rate.
- Redemption failure rate.

## 28. Product Positioning

For users:

**PointRush helps you complete simple verified missions, earn points, and redeem rewards without betting, gambling, or fake promises.**

For sponsors:

**PointRush helps you fund verified actions from real users and track what your campaign actually achieved.**

For the admin/business:

**PointRush turns user attention and action into a controlled rewards economy funded first by a launch pool, then increasingly by sponsors and partners.**

## 29. Confirmed Launch Clarifications (2026-09-27)

- Sponsor onboarding is lightweight: verified email, sponsor name, contact details and task information. No mandatory NIN, BVN, selfie, CAC upload or paid identity check at launch.
- Every task requires explicit platform review before it goes live, regardless of sponsor reputation, identity status or funding. Review includes objective, instructions, proof feasibility, rewards, deadlines and destination links. Material changes require reapproval; accepted participant terms remain protected.
- Locked funding protects allocated rewards, not sponsor identity or link safety. Never label a paying sponsor identity-verified automatically.
- Identity verification remains a separate planned capability alongside earned reputation. Provider, cost, evidence and user verification triggers are undecided. No provider integration or compulsory user ID gate is authorised by this clarification.
- Age eligibility is deferred. Do not infer an approved 18+ gate or an affirmative policy permitting all ages.
- Earlier suggested 10% fee, twice-weekly fulfilment, seven-day waiting period and revised referral payouts remain unapproved proposals; this update does not adopt them. Existing tentative economics remain subject to their documented open decisions.
