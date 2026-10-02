# Sponsor ownership and funded task creation

Migration 0008 adds owner-bound sponsor profiles and private funded task records. This document describes the creation slice. Publication and capped-fixed participation now exist in TASK_WORKFLOW.md; provider integration, public sponsor pages and frontend forms remain separate work. This slice does not make the product ready to accept real money.

## Access and onboarding

All routes use the existing session guard. Mutations require the configured trusted Origin; identities need verified email, completed account linking and active access. The service rechecks identity/access within its transaction. Caller-supplied owner IDs, sponsor IDs, contact emails, balances or approval fields are rejected.

There is one sponsor profile per owner account. This is a sponsorship identity, not a limit of one business per person. Separate business pages, staff memberships, delegated permissions, contact changes and profile amendments remain future work. Contact email is a snapshot of the verified authentication email. No sponsor ID documents or age gate are requested.

`SPONSOR_TERMS_VERSION` must identify actually published sponsor terms. Leave it unset until those terms and an acceptance screen exist. Profile creation then returns 503 rather than silently recording acceptance of invented terms. The client must submit that exact version and `acceptTerms: true`; the server records its timestamp. Changing the configured version blocks new task creation for old acceptances until a reacceptance flow is implemented. Existing task retries can still return their original result for an eligible owner.

| Route                           | Behaviour                                                                                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/api/v1/sponsor/profile`  | `{name, termsVersion, acceptTerms: true}`. Creates the profile and available-funds account atomically. Equivalent repeats return the same profile; changed content conflicts. |
| GET `/api/v1/sponsor/profile`   | Returns only the caller's own profile; 404 when absent.                                                                                                                       |
| POST `/api/v1/sponsor/tasks`    | Creates the task and full funding lock atomically from confirmed available funds.                                                                                             |
| GET `/api/v1/sponsor/tasks/:id` | Returns an owned task; unknown and foreign IDs both return 404.                                                                                                               |

Sponsor mutations currently use HTTP 201, including equivalent creation retries. No route credits money or calls a payment provider. Tests inject synthetic ledger funding internally.

## Task input

```json
{
  "requestId": "397fd682-d913-46cd-88c9-d797795b7ef2",
  "title": "Write an original product guide",
  "instructions": "Write a guide using the supplied brief.",
  "proofRequirements": "Submit the original document for review.",
  "rejectionCriteria": "Copied work or missing brief requirements.",
  "model": "selected_assignment",
  "capacity": 2,
  "rewardKobo": "1000000",
  "startsAt": "2027-01-10T09:00:00Z",
  "endsAt": "2027-01-20T18:00:00Z"
}
```

Supported models are `selected_assignment` and `capped_fixed`. Capacity may be one or two; creation never generates participant slots. Open participation and shared pools are not silently mapped to these models. Application/selection and claim-time commitment rules will be implemented separately.

The server multiplies capacity by rewardKobo using bigint: the example locks ₦20,000. Money inputs and outputs are integer decimal strings; numbers/fractions/coercion and bigint overflow are rejected. Capacity has PostgreSQL's positive integer bound. These are storage limits, not approved commercial spending limits. Reward kobo represents monetary backing; points conversion and participant reward issuance are not implemented.

Required text is bounded (name 120, title 160, instructions 10,000, proof and rejection criteria 5,000 characters). Unknown fields and invalid dates are rejected. Both dates require a timezone; the end must follow the start, and a new task's start must be strictly later than database time. These define the intended task window only, not submission, correction or appeal deadlines. Those terms must exist before publication. Replays are checked before checking whether the original start time has passed.

## Atomicity and review

The transaction locks the owner and available funding account, creates a task allocation and immutable ledger transfer, then creates the task. Failure rolls back everything. The allocation has a foreign-key binding to the task record through `allocationAccountId`; a database trigger additionally checks that its allocation UUID equals the task UUID, owner matches, and backing equals the calculated budget. Unique constraints prevent reuse of an allocation by two tasks. Caller request IDs are scoped to the sponsor and bind to a hash of normalized terms. Changed terms under the same ID return 409; identical retries return the original task without a second lock.

Every task starts `pending_review` and `not_live`. Migration 0009 now supports internal permission-checked, audited review decisions; see TASK_REVIEW.md. Protected admin review HTTP routes and capped-fixed publication now exist; see TASK_REVIEW.md and TASK_WORKFLOW.md. There is no amendment path. Funds stay locked through review, including rejection and changes-required. No sponsor flag or reputation level bypasses review. Cancellation and refunds need explicit settlement rules before an endpoint is introduced.

## Verification and next work

Service tests cover ownership, onboarding gates, exact budgets, replay conflicts, foreign reads, failed creation, transaction rollback after funding, suspended accounts and database rejection of unfunded/mismatched allocations. HTTP tests use real Better Auth sessions and check authentication, Origin, field tampering, ownership and insufficient funding. A native PostgreSQL two-connection duplicate-task test is checked in but not run here. PGlite tests do not substitute for native concurrency verification.

Next: admin MFA and protected review access, versioned amendments and a sponsor task listing with pagination. Publish real terms and build the acceptance/forms UI before enabling sponsor onboarding. Participant commitments, proof, appeals, reward backing, payments and refunds remain unimplemented. No infrastructure or hosted database was changed.
