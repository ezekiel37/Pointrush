# PointRush Validation and Approval Rules

Status: planning specification, 2026-09-27. Funding-at-creation, task-specific participation and later public verification badges are confirmed decisions. Numeric field limits below are adopted planning defaults from the review. Review timings are proposals; unresolved commercial/security policy is listed explicitly and must not be silently invented in code.

Related: [PRD](PointRush_PRD.md), [test cases](PointRush_Testing_Risk_Engineering_Rules.md), [UX contract](UX-CONTRACT.md), [design](DESIGN.md).

## 1. Validation Ownership

Browser validation provides feedback. NestJS validates every request, rejects unexpected fields, checks authenticated actor/ownership, and enforces transitions. Database constraints and transactions enforce uniqueness and financial invariants under concurrency. Share pure schema rules, not private business decisions, with the frontend. Never trust client roles, balances, badge status, funding amounts or timestamps.

Errors carry a stable code, optional field, safe message and request ID. Do not expose stack traces, account existence on private identity endpoints, provider secrets or sensitive evidence. Invalid format is distinct from conflict, insufficient funding, forbidden action and ambiguous provider processing.

## 2. Field Rules

| ID | Field | Contract | Enforcement and recovery |
| --- | --- | --- | --- |
| VAL-01 | Nigeria mobile phone | Local form: 11 digits including leading 0. With separate +234 selector: 10 national digits without trunk 0. Canonical form: +234 plus 10 digits, 14 characters including + | Maintained country-aware parser on client/server; reject unsupported country/type/extensions. Accept ordinary formatting spaces and hyphens; show a normalised preview |
| VAL-02 | International phone storage | E.164 maximum 15 digits excluding +; no invented universal minimum | Country-specific metadata; schema capacity accommodates + and 15 digits. Launch eligibility may remain Nigeria-only |
| VAL-03 | Phone ownership | One verified canonical account number; pending signup cannot permanently claim it | Unique database constraint at verification, challenge bound to account/number/purpose; safe recovery for existing ownership conflicts |
| VAL-04 | Username | 3-20 ASCII characters; lowercase canonical value; letters, digits, underscore; first character a letter; last alphanumeric; no consecutive underscores | Case-insensitive canonical unique constraint. Availability endpoint is rate-limited and advisory; conflict preserves form values |
| VAL-05 | Username lifecycle | Reserved official names and routes; one change per 30 days; old names reserved against impersonation | Backend policy and reservation records. IDs, not usernames, own ledger/referral/permission relations |
| VAL-06 | Display name | 1-80 Unicode code points after outer whitespace trim; reject control characters and invisible-only names; not unique | Support apostrophes, hyphens, spaces and non-Latin names; safe output rendering |
| VAL-07 | Email | Maintained syntax parser, ownership verification; no homemade restrictive regex | Define one canonical identity policy; do not silently strip plus tags or dots. Private login/reset responses do not reveal account existence |
| VAL-08 | Password | Permit paste, password managers and long passphrases; never silently truncate or trim | Proposed default: 15-128 characters for password login without mandatory MFA, compromised-password checks. Final auth-provider compatibility must be verified before implementation |
| VAL-09 | OTP | Purpose-bound, expiring, single use, attempt-limited, securely generated; resend cannot reset abuse counters | Numeric length, expiry, resend cooldown and distributed account/device/IP limits must be specified with the selected provider before shipping |
| VAL-10 | Points and money | Integer points; integer kobo; positive reward amounts; non-negative budgets; explicit upper bounds | Reject fractions, overflow and invalid numeric coercions. Limits and calculation ownership live on server; zero monetary reward permitted only for explicit voluntary participation |
| VAL-11 | Dates | Joining, completion, correction, review and appeal are separate deadlines | Store server timestamps in UTC; show timezone explicitly. Define exact inclusive/exclusive boundaries in APIs and test them; device clock is not authoritative |
| VAL-12 | Proof | Task-specific accepted types and evidence requirements; private storage | Server validates bytes/type/size, scans accepted uploads and controls access. Exact count/size/duration limits required per template; preserve upload retries without duplicate submissions |
| VAL-13 | Links/search | Bound length, parse links, reject unsafe schemes; limit/paginate search | Server-side URL fetching requires SSRF protections. Search cannot expose other tenants or bypass ownership filters |

Use type=tel, useful autocomplete and inputmode hints for phone/OTP. Do not set maxlength=11 on an input accepting international formatted paste. A valid phone format does not prove reachability, ownership or identity. Mobile prefix alone does not establish current carrier.

## 3. Account Access and Approval

Keep these dimensions separate: contact verification, access status, sponsor approval, public verification badge, reputation tier and redemption eligibility.

| Action | Gate | Failure/recovery |
| --- | --- | --- |
| Browse public missions | No account needed | Private campaigns remain permission-scoped |
| Join rewarded work | Verified email and phone, accepted terms, active/eligible account, task-model funding rules | Explain missing verification or eligibility; do not issue reward commitment until gates pass |
| Submit proof | Valid participation/selection, accepted rule version, applicable deadline | Preserve draft; distinguish deadline failure from upload/network error |
| Redeem | Verified contacts, available points, two approved missions, configured age/window/cap, no applicable restriction | Explain blockers; first redemption reviewed manually at launch; provider timeout remains processing until reconciled |
| Sponsor operations | Approved sponsor, actor membership/ownership and action permission | No access to other sponsors' campaigns or evidence |
| Admin operations | MFA and least-privilege action permission | Audit actor, reason, record version and transition; no balance editing |

Access states: active, restricted, suspended, closed. Verification states remain independent. Risk flags trigger evaluation, not automatic permanent guilt. A restriction records scope, reason, reviewer/owner, review deadline and appeal route. Preserve history/support access when safe. Shared phone/device/IP signals alone do not establish abuse.

Phone changes require reauthentication, new-number verification and notification to the old verified channel. Recovery after SIM recycling must not grant control solely through an SMS to the recycled number. Age eligibility, recovery evidence, first-redemption age, suspension/session rules and review deadlines require explicit launch decisions.

## 4. Task Configuration and Reward Commitments

Every template specifies participation mode, selection mode, reward model, timing, funding, repeatability, evidence and rejection criteria. Time-bound is independent of capacity; one campaign may contain multiple tasks.

| Model | Participation | When individual funds are committed |
| --- | --- | --- |
| Selected assignment | Many applications; configured selection count, including 1 or 2 | At selection before work begins; application does not promise payment |
| Capped fixed reward | Eligible participants claim funded capacity | At successful claim/join, atomically with capacity check |
| Time-bound campaign | Within configured dates under another reward model | According to that model; dates do not make funding unlimited |
| Open participation | Potentially unlimited participants | Before a fixed reward promise; voluntary participants must see that they have no guaranteed reward |
| Shared pool (planned) | Eligible participants share fixed budget | Entire pool locked at funded creation; individual allocation follows disclosed formula at settlement |

Do not automatically create rewarded slots for every task. Commitment expiry must be disclosed before acceptance. Timely submissions retain protection through review, corrections and appeals. Deadline expiry releases only genuinely unused commitments. Claims need anti-hoarding limits; exact per-user concurrency/duration policy must be selected per template.

Shared pools stay disabled until allocation formula, rounding/remainder, zero-participant outcome, minimum payout, eligibility and dispute rules are defined. Fixed and variable reward copy must be visibly different.

## 5. Funding at Task Creation

FIN-01: A funded task and its full allocated reward lock are created in one transaction from confirmed available sponsor funds. An unfunded draft is allowed but cannot publish or accept participants. Failure must leave neither an orphan lock nor an unfunded active task.

FIN-02: Funding requests are idempotent. Verify provider signature and account/reference/amount/currency; redirects and client receipts are insufficient. Duplicate or out-of-order events cannot credit twice. Delayed confirmation leaves funding pending until trusted reconciliation.

FIN-03: Track available sponsor funds, task-locked uncommitted budget, individual commitments, approved reward backing, fees and authorised releases separately. Campaign totals aggregate allocations and cannot spend the same balance again. Fees are disclosed and accounted separately from rewards.

FIN-04: Approval atomically consumes the relevant commitment and credits immutable user ledger entries once. Backing for approved points remains unavailable to the sponsor while rewards remain owed. Approval, refund, cancellation and budget edits serialize against the same financial state.

FIN-05: Cancellation closes new commitments. Existing work, submissions, corrections and appeals remain protected. Refund/rollover can use only settlement-authorised unused funds. Rejected work releases funding only after its appeal rights conclude. A sponsor dispute alone never reverses valid earnings.

FIN-06: Material changes require versioned terms and re-review. New allocation increases lock additional confirmed funds before publication; decreases cannot invade commitments. A task's accepted terms cannot change retroactively. A provider chargeback is a separate risk case: pause new exposure and investigate without inventing or silently confiscating user funds.

## 6. Sponsor and Submission Decisions

Sponsor approval requires verified contact, accountable owner, evidence appropriate to individual/business type, authority to represent that entity and accepted terms. Manual review applies at launch. A corporate email or registration document alone is not sufficient proof of representation. Exact evidence/retention policy remains open.

Task publication requires approved sponsor, approved current task version, locked budget for rewarded work, feasible proof and permitted objective. Funding status (unfunded/pending/locked/settled) and review status (draft/pending_review/changes_required/approved/rejected) are separate from lifecycle (not_live/live/paused/closing/completed/cancelled/suspended).

| Decision | Authorised actor | Required evidence/effect |
| --- | --- | --- |
| Approve sponsor/task | Platform reviewer with permission | Review checklist, version and reason recorded; cannot approve own sponsor/task |
| Select applicant | Authorised sponsor/platform operator | Eligibility and funding checked; selection count enforced atomically |
| Review submission | Scoped sponsor reviewer or platform reviewer | Check accepted terms and proof; cannot review own work |
| Approve reward | Authorised review command | Audited atomic ledger/funding transition; duplicate request returns original result |
| Request correction/reject | Scoped reviewer | Actionable reason tied to accepted requirements; notification and appeal route |
| Decide appeal | Platform reviewer, independent where possible | Stored terms, evidence and prior decisions; self-review conflicts escalated |
| Release/refund | Explicit finance permission | Available settlement amount, recipient, policy and idempotency verified; thresholds for second approval remain open |

Submission progression: submitted -> under_review -> approved / changes_required / rejected. Corrections return to review. Appeals are separate records and can uphold rejection or overturn it through one audited approval transition. Approved ledger entries are immutable; corrections use compensating entries with evidence.

Proposed operating targets: review within 72 hours; one correction opportunity within 48 hours when fixable; appeal within 7 days of rejection notice. Sponsor silence escalates to PointRush, never automatic rejection/payment. Capacity to staff these targets must be confirmed before launch. AI can flag, classify and assist; it cannot independently impose permanent bans or irreversible reward decisions.

## 7. Later Public Verification Badges

VER-01: Contact verification proves channel control and gives no public identity badge. Sponsor approval allows sponsor actions and does not automatically grant a badge. Tiers represent activity/reputation, not identity.

VER-02: Later badges state the check performed: sponsor identity/business representation; user identity; creator linked-profile ownership. They never guarantee honesty, earnings or platform endorsement. Payment or membership cannot purchase an approval outcome.

VER-03: Store subject ID, check scope, status, evidence reference, reviewer, verified date, expiry/review date where applicable, reason history and appeals. Support pending, approved, rejected, expired and revoked outcomes; ownership changes trigger re-verification. Retention and exact evidence policy must be settled before collecting identity documents.

VER-04: Badge status is server-issued and cannot be edited through profile APIs. Sponsors/public viewers receive only appropriate results, not private identity documents. Badges never bypass funding, proof, permission or fraud controls. Feature is deferred; no unnecessary evidence collection at launch.

## 8. Unresolved Launch Gates

- Age eligibility, identity recovery and personal-data retention policies.
- OTP provider/cost and exact security limits; mandatory phone verification has an operating cost separate from the reward pool.
- First-redemption waiting period, Starter cap, redemption window and restriction-review deadlines.
- Non-referral progression thresholds, approval-rate denominator and active-day definition.
- Confirmation of proposed review/correction/appeal targets and staffing.
- Upload/template bounds, money upper bounds and anti-hoarding policies.
- Commercial fees/refunds, chargeback loss handling and high-value dual approval thresholds.
- Shared-pool formula and verification-badge evidence/expiry before enabling those later features.

## 9. Reference Sources

- [NCC numbering allocations](https://www.ncc.gov.ng/operators/national-numbering-plan)
- [ITU E.164 recommendation](https://www.itu.int/itu-t/recommendations/rec.aspx?id=16273)
- [OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP input validation](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
- [NestJS validation](https://docs.nestjs.com/techniques/validation)

Sources inform implementation; PointRush-specific lengths, review periods and task policies are product decisions, not claims that these sources mandate them.
