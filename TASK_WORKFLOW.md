# Individual funded-task workflow

## Implemented backend scope

Migration 0012 adds reviewed `workTerms`, publication history, fixed-capacity participant claims, versioned text evidence, sponsor decisions, independent appeals and reward-backing ledger credits. Migration 0013 records decision receipt and protects correction/appeal windows until receipt. The backend is implemented for `capped_fixed`; it does not reinterpret `selected_assignment` as first-come-first-served.

New task creation may include:

```json
{
  "workTerms": {
    "reviewHours": 72,
    "correctionHours": 48,
    "appealHours": 168,
    "settlement": "approved_reward_backing"
  }
}
```

These numbers are examples matching the proposed operating targets, not hardcoded defaults or approved launch commitments. Explicit values enter the task creation hash, are visible to platform reviewers, and remain immutable with the accepted brief. Legacy tasks without these terms stay private even when approved. Terms cannot be appended after review. Technical bounds are 1–720 hours for review/correction and 1–2160 hours for appeals. Launch staffing and template policy still need to support the chosen values.

## States and money

1. Creation locks the entire task budget, as before.
2. The existing platform task-review process must approve the task.
3. Publication verifies ownership, active sponsor access, approved immutable terms, supported model, end time and full funding. A published task can be scheduled; claims open at startsAt inclusive and close at endsAt exclusive.
4. A claim is created only for an active participant distinct from the sponsor, while the sponsor remains active and capacity is available. The claim records the commitment to the immutable task terms. Task-row locking and a unique task/account key protect capacity and repeat joining. Claims are not pre-created slots. There is currently no claim recycling, automatic forfeiture or refund endpoint.
5. First proof must arrive before endsAt. Evidence is bounded text (up to 10,000 characters); no URL is fetched or treated as verified proof. Uploaded file evidence remains separate future integration work.
6. The sponsor approves, rejects or requests one correction with a reason. Correction revision 2 is allowed only after changes_required; a second correction request is rejected. Sponsor silence does not pay or reject work automatically. ReviewHours is a stored review target; an overdue queue/notification worker remains necessary.
7. The participant explicitly acknowledges receipt of a decision. Correction/appeal windows run from that server-recorded receipt, not from a potentially unseen decision. No acknowledgement means the window does not expire. Repeated acknowledgements cannot restart a window.
8. A rejected proof can be appealed once within the receipt-based window. An active independent arbitrator needs a separate unexpired `appeal_reviewer_grants` permission and recent MFA over HTTP. Sponsor and participant cannot arbitrate their own dispute. Task-review permission alone does not authorize arbitration. Appeal-only reviewers may enroll in MFA.
9. Approval, including an appeal overturn, atomically credits the participant's reward-backing account from the locked task allocation. The database decision trigger and transfer commit or roll back together. The stable `claim:<UUID>` journal reference prevents double credit. Database checks bind source allocation, beneficiary, approved proof/appeal, amount and actor.

`reward_wallet` is an accounting bucket for approved monetary backing, not cash withdrawal, a payment-provider transaction, points conversion or spendable airtime. Existing point conversion policy is not silently invented here. Rejected work and upheld appeals retain their allocation; settlement-authorized release/refund is not implemented.

## HTTP contract

All paths below are under `/api/v1/work`. Sessions require verified email and active linked accounts. Mutations require a trusted Origin. Actor IDs never come from editable input.

| Method/path                        | Input/access                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| GET `tasks/:id`                    | Published brief, work terms, reward backing and claimed capacity                                |
| POST `tasks/:id/publish`           | Sponsor owner; repeated publication returns the original record                                 |
| POST `tasks/:id/join`              | Eligible participant; repeated joins return the original claim                                  |
| GET `claims/:id`                   | Claim owner or task sponsor; evidence, decisions, receipts and appeals                          |
| POST `claims/:id/proofs`           | Participant: `{id, revision, evidence}`                                                         |
| POST `proofs/:id/decisions`        | Sponsor: `{id, decision, reason}`                                                               |
| POST `proofs/:id/acknowledgements` | Participant; records first decision receipt                                                     |
| POST `proofs/:id/appeals`          | Participant: `{id, reason}`                                                                     |
| GET `appeals/:id`                  | Independent appeal reviewer with recent MFA; reviewed brief and proof history                   |
| POST `appeals/:id/resolutions`     | Independent appeal reviewer with recent MFA: `{id, decision, reason}`; decision approved/upheld |

IDs in command bodies are client-generated stable UUIDs. Identical retries return the original authorized result; changed content under the same ID conflicts. Monetary API values use decimal strings. Foreign claim/proof access returns 404. Workflow constraint conflicts return a safe 409 response without database details.

## Deployment and verification limits

Use runtime SELECT-only privileges on permission tables. Appeal permissions require a separate controlled operator workflow; there are no default arbiters or public permission writes. The new permission table retains grants and permits only one-way revocation. Production provisioning and a fuller revocation audit are release work.

Local PGlite tests execute real migrations and cover publication gates, legacy records, capacity, ownership, proof retries, corrections, decision receipts, independent arbitration, exact single credit, forged credit rejection and atomic rollback. HTTP tests mount the workflow module and check session, Origin, unpublished read and arbitration permission boundaries. Native multi-connection PostgreSQL concurrency has not been verified in this environment. PGlite serial tests are not evidence of production race testing.

Next integration work: sponsor/tasker/arbitrator screens, task and review queues, notifications/overdue escalation, file evidence, operational permission provisioning, approved points conversion, settlement/release policies and native concurrency tests. Until these are connected and validated, this is a backend workflow, not a launch-ready earning journey. No hosted migration or real funding has occurred.

## Discovery and return visits

The following authenticated GET routes now accept `limit` (default 25, maximum 50) and `after` (UUID cursor), returning `{items, nextCursor}`:

- `/api/v1/work/tasks`: published, approved tasks from active sponsors whose end time has not passed. Optional `q` searches the title using a literal case-insensitive substring. Scheduled/full tasks remain visible with dates and claimed capacity; listing is not a guarantee of claim eligibility.
- `/api/v1/work/claims`: only the session owner's commitments, with latest proof ID and approved backing as a decimal string. Expired tasks remain accessible here.
- `/api/v1/work/sponsor/tasks`: only the sponsor owner's tasks, including unpublished ones.
- `/api/v1/work/tasks/:id/claims`: participant claims visible only to that task's sponsor owner. This list does not disclose proof text or participant contact information.

UUID cursor ordering is stable for existing rows but is not chronological or a snapshot; refresh the first page to find newly inserted work. Unknown query fields, including caller-supplied ownership filters, are rejected. Title search is intentionally simple; PostgreSQL full-text indexing can follow measured search needs. The read projections live separately from transactional task commands.
