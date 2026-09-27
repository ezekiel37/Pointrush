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
