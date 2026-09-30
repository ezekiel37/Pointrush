# PointRush UX Contract

Status: planning contract. Related: [design](DESIGN.md), [validation and approval rules](PointRush_Validation_Approval_Rules.md), [tests](PointRush_Testing_Risk_Engineering_Rules.md).

## Forms

- Reuse labelled field, help/error, input, select, confirmation and notification primitives. Avoid giant configurable form components that contain unrelated domain logic.
- Show requirements before mistakes. Labels remain visible; placeholders are examples, not labels. Identify optional fields.
- Validate on blur or submit initially; after an error, revalidate on correction. Own product validation feedback with noValidate while retaining semantic input types, autocomplete and useful constraint metadata.
- Inline errors explain corrections and associate through aria-describedby/aria-invalid. Submit focuses the first invalid field; long forms also receive a linked error summary.
- Keep submit available to reveal errors; disable during processing. Explain other unavailable actions. Preserve button dimensions and expose busy status accessibly.
- Preserve values after failure. Save only appropriate non-sensitive drafts. Never persist passwords/OTPs in browser storage or expose them through logs, analytics, URLs or error messages.
- Permit paste, autofill and password managers. Mask secrets with an accessible visibility toggle. Use tel/inputmode appropriately; phone/OTP values are strings, not arithmetic numbers.
- Select/date components must have explicit native or authored behaviour and consistent keyboard, focus, viewport collision and mobile handling.
- Warn about losing unsaved edits. Session expiry allows reauthentication/recovery without discarding safe draft content; do not automatically replay a financial operation.

## Task and Reward Clarity

- Show participation model, selection requirements, reward amount/type, available funded capacity where relevant, steps, proof example, deadlines/timezone, review expectations and rejection/appeal rules before commitment.
- Use Apply for selection, Claim funded place and Join campaign according to actual behaviour. Applying does not imply selection; joining does not universally imply payment.
- Distinguish fixed commitments, voluntary participation and variable shared-pool estimates. Do not expose shared-pool features before the formula is approved.
- Sponsor funded-creation confirmation shows reward allocation, separate fees and resulting available funds. Insufficient funding preserves the draft without publishing it.
- Redemption confirmation shows recipient, current selected network, reward, points deduction and any fee. Never infer carrier solely from number prefix.
- Pending, available, restricted and redeemed points have explicit explanations. Identity/business badges state verification scope; reputation levels describe earned history. Neither replaces eligibility messaging or mandatory task approval.

## Async and Recovery

- Every workflow supports loading, empty, success, error and blocked states. Differentiate no results from no data and permission denial from provider failure.
- A timeout is not proof that payment/redemption failed. Show processing/verification required and reconcile the original operation before retrying; reuse its idempotency identity.
- In-app history holds critical outcomes; toast/push is supplementary. Notification failure never changes financial state or hides a deadline.
- Fetch current state on initial open and reconnect; event-driven updates may then refresh it. Ignore stale responses and reconcile missed events.
- Preserve pending submissions and appeals when tasks close. Explain restrictions and provide contextual support with record references.
- Keep support/history accessible during restrictions where safe; never show sensitive internal fraud signals to attackers.

## Search and Lists

- Server-side pagination/filter/sort for non-trivial admin and sponsor lists; authorisation is enforced before results are returned.
- Debounce remote search about 300ms, respect IME composition, submit immediately on Enter and cancel/ignore superseded responses.
- Clear button resets immediately and restores input focus. Reset paging after filter changes; handle empty pages after deletion.
- Keep non-sensitive committed query/filter/page state in the URL; avoid personal identity values in URLs without an explicit privacy decision.

## Shared Interaction Rules

- Native buttons for actions and links for navigation; visible keyboard focus and accessible icon names. Controls work with touch and keyboard, not hover alone.
- App-owned accessible confirmations for costly/destructive actions, with specific verbs and consequences. Routine reversible edits should not cause confirmation fatigue.
- Stable layouts during loading/errors; no keyboard-obscured submit controls. Use real status text alongside colour/icons.
- One notification/toast system, one form error pattern, one confirmation pattern and consistent save/cancel outcomes across portals.
- Uploads show allowed formats/limits before selection and support progress, cancellation and safe retry; backend validates file content independently.

## Required Verification

Exercise successful/invalid forms, conflict, double submit, expired session, offline/reconnect, stale task rules, unknown provider outcome, mobile keyboard, screen reader errors, keyboard navigation and zoom. Frontend prevention never substitutes for backend transactions, permissions or validation.

## Sponsor Onboarding and Public Trust

- Launch sponsor onboarding asks for verified email, sponsor name, contact details and task information; do not insert mandatory NIN/BVN/selfie/CAC steps.
- Funded creation locks the task allocation, then the task remains unpublished until platform review approves its current version. Show funding and review as separate statuses; material edits require reapproval.
- New sponsors and users display New reputation. Identity verification and earned reputation may coexist; paid funding, points or referrals never manufacture either.
- Allow feedback only on real eligible interactions, once per interaction, with anti-retaliation publication timing and an appeal route. Private fraud signals are not public profile labels.
- Later identity verification uses a separate explicit flow; provider, cost and triggers remain unresolved. Do not add an age field or gate based on the earlier unaccepted age proposal.

## Offline and Online Codes

- QR is optional. Manual claim-code entry must work for bottle caps, tickets, books and printed receipts.
- Show the standard code in grouped form, such as `PR-ABC-7K4M-9X2QD`, with clear copy/paste and camera-scan options where available.
- Reusable business or campaign QR codes open discovery pages and never award points. Unique claim codes resolve to a specific task, batch, reward and expiry on the server.
- Opening a code does not consume it. After a successful claim, show the reward, task and claim status. Repeated claims show the original outcome or a clear used/expired state.
- Do not ask offline sellers to enter every sale in PointRush. The business receives controlled code batches for packaging, tickets, inserts or receipts; batch activation draws from already locked task funds.
- Online businesses may pass a code or authenticated event reference from checkout. A click alone is not a purchase; the UI must state what qualifies before participation.
- Customers cannot edit the reward value. Different code batches may resolve to different points, airtime, data, vouchers or discounts.

## Implemented account UI ownership

The account slice uses Nigerian English (`en-NG`), light mode and document scrolling. Sources: `AUTH.md` for session and email behavior, `ACCOUNTS.md` for account states, and shared `@pointrush/contracts` for identity validation. No existing sibling UI preceded this slice; signup and recovery establish the first shared form behavior.

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Form | `apps/web/src/components/ui/form.tsx`, `field.tsx`, React Hook Form/Zod | This contract and shared validation | Login, signup, email request, password reset, onboarding | Browser validation, labels, focus, failure recovery |
| Scrollbar | `apps/web/src/app/globals.css` | DESIGN.md | Global baseline; forced-colors override | Browser computed styles and narrow viewport |
| Feedback | `apps/web/src/components/ui/feedback.tsx` | This contract | Persistent error or status; no toast-only outcomes | Browser role/status assertions |
| Account reads | `account-screen.tsx` and `lib/account.ts` | ACCOUNTS.md | Initial load, reconnect, visibility return, explicit retry | Browser failure and expiry scenarios |
| Button/Input | `components/ui/button.tsx`, `input.tsx` | DESIGN.md | Primary, outline, ghost; native text/password | Keyboard, password reveal, automated accessibility |

- Forms are disabled until hydration and declare POST as a fallback, preventing native GET submission of credentials. Shared Form owns `noValidate`; call sites declare it explicitly too.
- Authentication uses Better Auth's client. Cookies remain HTTP-only; no password/token/session storage or analytics are introduced. Reset tokens are held in memory and removed from the address bar; refreshing requires reopening the email link.
- Signup success asks users to check email and sign in; it never claims to have created a session. Reset/resend confirmations do not reveal whether an address exists.
- Login routes to `/account`. The API decides whether to show setup, account summary or restriction. Status reads are private; client navigation is not authorization.
- Submission locks prevent duplicate clicks. Writes are never retried automatically. Network errors acknowledge an uncertain outcome; onboarding retries use the server's existing idempotent behavior.
- An expired session during onboarding keeps the form in memory and offers sign-in in another tab. Safe revalidation runs on return/reconnect; closing or reloading the tab discards the form. No draft is persisted on shared devices.
- Pre-launch help explicitly identifies unavailable tasks, rewards and support. No fake amounts, earnings, tasks, sponsor approvals or verified-identity labels appear.
- No offline cache, push registration or service worker is included yet. PWA delivery remains a separate feature; do not cache private account/auth responses when adding it.
