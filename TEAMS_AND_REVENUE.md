# Teams, paid work and revenue

Agreed product direction, 1 October 2026. This is a requirements document, not a claim of implemented features. Read with Acticlaim_PRD.md, Acticlaim_Validation_Approval_Rules.md and the testing rules. Existing individual missions, physical-business campaigns and redemption offerings remain in scope.

## Useful paid-work journey

A sponsor commissions a defined outcome, such as photos, captions and a short video. An individual or an eligible team applies. The accepted participants agree responsibilities and reward allocations; the sponsor's allocated funds are already locked. Participants submit attributable work, it is reviewed under the published rules, and approved rewards are credited to each member. A satisfied sponsor can rehire the team through a newly funded, reviewed task.

Task publication review and completed-work acceptance are separate decisions. Internal team approval is coordination only. No leader, sponsor or authentication plugin can bypass platform review, proof requirements or financial invariants. Avoid calling the funding lock legal escrow or promising protection from all chargebacks.

## Membership and project roles

| Role         | Allowed responsibility                                                               | Boundary                                                                          |
| ------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Team owner   | Invite/remove members, propose ownership transfer, appoint leads                     | Cannot seize rewards, rewrite completed contributions or access personal balances |
| Project lead | Assign agreed work, coordinate deadlines and internal feedback, assemble submissions | Cannot change accepted shares unilaterally or authorize payouts                   |
| Contributor  | Accept assignments, submit own evidence, see agreed scope and allocation             | Cannot view unrelated projects or private member data                             |

Membership requires an accepted invitation tied to the intended identity. Invitations must expire and be revocable; exact limits are to be chosen before release. Multiple-team membership is allowed conceptually, but eligibility is checked against the actual person for every task. Public profiles show consenting members and accepted project evidence without exposing private proof or sponsor-confidential materials.

Roles are scoped: an owner can contribute under another member's project leadership. A lead must be an eligible accepted member. Removal revokes future team access, but members retain a personal route to their own contribution, reward and dispute records. Ownership transfer requires acceptance by an eligible new owner. Archiving a team cannot delete outstanding commitments or audits; unresolved obligations prevent destructive closure.

## Work and reward agreement

Before work begins, snapshot the participant roster, tasks, evidence requirements, deadlines, acceptance criteria and exact member allocations. Display the full agreement before acceptance. A project may track not started, in progress, submitted, changes requested and accepted states. Dependencies are simple links between assignments, not a general workflow engine.

Allocations must sum exactly to the backed reward amount in the applicable ledger units. Use integers and a documented deterministic remainder rule if a percentage input is offered. No floating-point money. A participant cannot receive the full task reward again through another team. A team application consumes capacity according to the published participation unit; it must not silently create one paid slot per member.

Changing unfinished work requires a versioned amendment and acceptance from affected members. Sponsor approval and additional locked funds are required where sponsor terms or budget change. Preserve the old agreement until its replacement is accepted. Membership changes never silently rewrite agreed recipients. Completed accepted work remains payable to its original contributor, subject to existing fraud/dispute controls; incomplete or disputed work remains reserved pending the published resolution process.

Milestones are a later supported task model: each must define its acceptance criteria, exact backing and reward shares. Lock the full created-task allocation before publication. Milestone settlement cannot spend the same backing twice, exceed the total or release disputed obligations. Partial acceptance, missed dependencies, cancellation, appeals and refund treatment must be specified before enabling this model. Current immutable version-1 task code does not support these amendments or milestones.

## Reputation

Keep personal contribution history, team delivery history and leadership experience distinguishable. Base public signals on eligible independently accepted outcomes and upheld dispute results. Do not award the full project contribution to every member automatically. Member departure does not erase history, and later joiners do not inherit personal credit for earlier projects.

Repeated counterparties, related sponsor/tasker accounts, reciprocal approvals and trivial projects must not generate unlimited trust. A reputation title never grants platform-admin permission. Scoring weights, sample thresholds, attribution evidence and appeal corrections remain required design decisions before reputation launches. Never sell favourable reviews, earned trust or a misleading verification badge.

## Revenue priorities

| Feature                                | Customer value                                                 | Revenue approach                                          | Sequence                      |
| -------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------- |
| Funded work and reliable acceptance    | Sponsor buys a defined result; participant sees backed rewards | Separately disclosed fee on successfully settled work     | Core first                    |
| Rehire individual/team                 | Repeat successful work with less setup                         | Fee on each new funded engagement                         | After first completed journey |
| Team application and portfolio         | Sponsor assesses a group with relevant contribution evidence   | Supports completed-work volume; no basic team fee         | Team phase                    |
| Milestones                             | Accept and reward clearly defined stages                       | Covered by disclosed work pricing; no extra fee assumed   | After staged-settlement rules |
| Funded offers and redemption campaigns | Businesses acquire qualifying actions/purchases                | Campaign/service pricing and disclosed fulfilment charges | Existing broader roadmap      |
| Advanced team or sponsor tools         | Optional operational convenience                               | Subscription only after demonstrated demand               | Later                         |

Illustration only: ₦50,000 reward allocation plus an 8% service fee equals ₦54,000 before processing charges. ₦50,000 stays reward backing; ₦4,000 is potential gross service revenue, not profit. Neither the percentage nor fee recognition/refund timing is approved. Do not implement this example as a pricing default. A payment collected before work completion is not automatically an earned fee.

Before enabling billing, agree and version fee basis, collection and earning events, who bears processing charges, cancellation/refund treatment, disputes and chargeback losses. Store reward liabilities, fee balances, refunds and provider references separately. A retry must not charge or credit twice. Public pricing must disclose the total before funding and preserve each participant's accepted reward.

The ₦100,000 launch pool funds eligible launch rewards only. Do not recycle promised reward backing into operating costs or claim platform-funded pilot activity as paying-sponsor demand. Track external sponsor revenue separately. Pilot metrics: funded sponsor conversion, successful delivery, repeat hiring, disputes, support time, net contribution after variable costs and remaining uncommitted launch rewards. No guaranteed earnings or arbitrary pool-spending schedule is implied.

## Build versus reuse

Evaluate Better Auth Organization for invitations, accepted membership, team roles and ownership mechanics before implementing team identity. Its organization/team structure must be mapped to Acticlaim's tasker teams and sponsor workspaces; plugin roles are not automatically project roles. Do not duplicate the same membership authority in two mutable systems. Acticlaim owns project assignments, immutable work agreements, reputation evidence and financial records.

Keep provider identifiers behind the membership boundary and use Acticlaim account IDs in financial and contribution records. Authorization must be checked again when accepting an invitation, assigning work or changing membership, including direct plugin endpoints. Organization membership never grants platform review permission or broad access across sponsors. No plugin installation or membership schema migration is included in this documentation change.

Later: shared wallets, nested hierarchy, custom role builders, paid team subscriptions and broad project-management tools. None is necessary to demonstrate one reliably completed paid task.

References checked 1 October 2026: [Better Auth Organization](https://www.better-auth.com/docs/plugins/organization), [Better Auth Admin](https://www.better-auth.com/docs/plugins/admin). Application policy above is Acticlaim's own contract, not a library guarantee.
