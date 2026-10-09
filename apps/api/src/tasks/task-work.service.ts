import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import * as s from '../database/schema.js';
import { actorTransaction } from './actor-transaction.js';

const id = z.uuid();
const reason = z.string().trim().min(1).max(2000);
const proofInput = z
  .object({
    id,
    revision: z.number().int().min(1).max(2),
    evidence: z.string().trim().min(1).max(10000),
    // Up to 3 uploaded photos or PDFs, fixed once submitted.
    files: z.array(z.uuid()).max(3).optional(),
  })
  .strict();
const decisionInput = z
  .object({
    id,
    decision: z.enum(['approved', 'changes_required', 'rejected']),
    reason,
  })
  .strict();
const appealInput = z.object({ id, reason }).strict();
const resolutionInput = z
  .object({ id, decision: z.enum(['approved', 'upheld']), reason })
  .strict();
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException('Invalid task command');
  return result.data;
}

export class TaskWorkService {
  constructor(private readonly db: FundingDatabase) {}

  private run<T>(
    authUserId: string,
    action: (tx: FundingDatabase, actor: string) => Promise<T>,
  ) {
    return actorTransaction(this.db, authUserId, action);
  }

  async readTask(user: string, taskId: string) {
    parse(id, taskId);
    return this.run(user, async (tx, actor) => {
      const [task] = await tx
        .select()
        .from(s.sponsorTasks)
        .where(
          and(
            eq(s.sponsorTasks.id, taskId),
            eq(s.sponsorTasks.lifecycle, 'published'),
          ),
        );
      if (!task) throw new NotFoundException();
      const [count] =
        task.model === 'purchase_cashback'
          ? await tx
              .select({ used: sql<number>`count(*)::integer` })
              .from(s.purchaseConfirmations)
              .where(
                and(
                  eq(s.purchaseConfirmations.taskId, taskId),
                  sql`purchase_holds_place(${s.purchaseConfirmations.id})`,
                ),
              )
          : await tx
              .select({ used: sql<number>`count(*)::integer` })
              .from(s.taskClaims)
              .where(eq(s.taskClaims.taskId, taskId));
      return {
        id: task.id,
        title: task.title,
        instructions: task.instructions,
        proofRequirements: task.proofRequirements,
        rejectionCriteria: task.rejectionCriteria,
        startsAt: task.startsAt,
        endsAt: task.endsAt,
        workTerms: task.workTerms,
        model: task.model,
        campaignTerms: task.campaignTerms,
        rewardBackingKobo: task.rewardKobo.toString(),
        capacity: task.capacity,
        claimed: count!.used,
        groupComplete:
          (
            await tx
              .select({ taskId: s.campaignGroupCompletions.taskId })
              .from(s.campaignGroupCompletions)
              .where(eq(s.campaignGroupCompletions.taskId, task.id))
          ).length > 0,
        termsVersion: task.termsVersion,
        // Who runs it, linking to their public page.
        business: await this.business(tx, task.sponsorId),
        // Bring-a-friend offers: whether this person can invite (they have
        // bought here before), their username for the link, and how many
        // friends they brought to this offer.
        invite: task.campaignTerms?.referral
          ? await this.invite(tx, task, actor)
          : null,
      };
    });
  }

  private async business(tx: FundingDatabase, sponsorId: string) {
    const result = (await tx.execute(sql`select sp.name,
        (select handle from business_handles h where h.sponsor_id = sp.id order by seq desc limit 1) as handle
      from sponsor_profiles sp where sp.id = ${sponsorId}`)) as unknown as {
      rows: { name: string; handle: string | null }[];
    };
    const row = (result.rows ?? (result as unknown as typeof result.rows))[0];
    return row ? { name: row.name, handle: row.handle } : null;
  }

  // Bring-a-friend offers: whether this person can invite (they have bought
  // here before), their username for the link, and how many friends they
  // brought to this offer.
  private async invite(
    tx: FundingDatabase,
    task: { id: string; sponsorId: string },
    actor: string,
  ) {
    const result = (await tx.execute(sql`select
        exists (select 1 from purchase_confirmations p join sponsor_tasks st on st.id = p.task_id
          where st.sponsor_id = ${task.sponsorId} and p.account_id = ${actor}
            and (not exists (select 1 from purchase_voids v where v.confirmation_id = p.id)
              or exists (select 1 from purchase_void_rulings r where r.confirmation_id = p.id and r.decision = 'reversed'))) as can_invite,
        (select username from usernames where account_id = ${actor} and is_current) as username,
        (select count(*)::int from purchase_confirmations p where p.task_id = ${task.id}
          and p.referrer_id = ${actor} and purchase_holds_place(p.id)) as invited`)) as unknown as {
      rows: { can_invite: boolean; username: string | null; invited: number }[];
    };
    // node-postgres returns { rows }; some drivers return the rows directly.
    const row = (result.rows ?? (result as unknown as typeof result.rows))[0]!;
    return {
      canInvite: Boolean(row.can_invite),
      username: row.username,
      invited: Number(row.invited),
      limit: 10,
    };
  }

  async publish(user: string, taskId: string) {
    parse(id, taskId);
    return this.run(user, async (tx, actor) => {
      const [task] = await tx
        .select({ id: s.sponsorTasks.id, owner: s.sponsorProfiles.ownerId })
        .from(s.sponsorTasks)
        .innerJoin(
          s.sponsorProfiles,
          eq(s.sponsorProfiles.id, s.sponsorTasks.sponsorId),
        )
        .where(eq(s.sponsorTasks.id, taskId))
        .for('update', { of: s.sponsorTasks });
      if (!task || task.owner !== actor) throw new NotFoundException();
      const [existing] = await tx
        .select()
        .from(s.taskPublications)
        .where(eq(s.taskPublications.taskId, taskId));
      if (existing) return existing;
      return (
        await tx
          .insert(s.taskPublications)
          .values({ taskId, actorId: actor })
          .returning()
      )[0]!;
    });
  }

  async join(user: string, taskId: string) {
    parse(id, taskId);
    return this.run(user, async (tx, actor) => {
      const [task] = await tx
        .select({ id: s.sponsorTasks.id })
        .from(s.sponsorTasks)
        .where(eq(s.sponsorTasks.id, taskId))
        .for('update');
      if (!task) throw new NotFoundException();
      const [existing] = await tx
        .select()
        .from(s.taskClaims)
        .where(
          and(
            eq(s.taskClaims.taskId, taskId),
            eq(s.taskClaims.accountId, actor),
          ),
        );
      if (existing) return existing;
      return (
        await tx
          .insert(s.taskClaims)
          .values({ taskId, accountId: actor })
          .returning()
      )[0]!;
    });
  }

  private async claim(
    tx: FundingDatabase,
    claimId: string,
    actor: string,
    sponsor = false,
  ) {
    const [row] = await tx
      .select({ claim: s.taskClaims, owner: s.sponsorProfiles.ownerId })
      .from(s.taskClaims)
      .innerJoin(s.sponsorTasks, eq(s.sponsorTasks.id, s.taskClaims.taskId))
      .innerJoin(
        s.sponsorProfiles,
        eq(s.sponsorProfiles.id, s.sponsorTasks.sponsorId),
      )
      .where(eq(s.taskClaims.id, claimId))
      .for('update', { of: s.taskClaims });
    if (!row || (sponsor ? row.owner : row.claim.accountId) !== actor)
      throw new NotFoundException();
    return row;
  }

  async submit(user: string, claimId: string, input: unknown) {
    parse(id, claimId);
    const value = parse(proofInput, input);
    return this.run(user, async (tx, actor) => {
      await this.claim(tx, claimId, actor);
      const [existing] = await tx
        .select()
        .from(s.taskProofs)
        .where(eq(s.taskProofs.id, value.id));
      if (existing) {
        if (
          existing.claimId !== claimId ||
          existing.revision !== value.revision ||
          existing.evidence !== value.evidence
        )
          throw new ConflictException('Proof ID already used');
        return existing;
      }
      const { files = [], ...proof } = value;
      if (new Set(files).size !== files.length)
        throw new ConflictException('Each file can be attached once');
      const [created] = await tx
        .insert(s.taskProofs)
        .values({ ...proof, claimId })
        .returning();
      // The database checks each file is the worker's own evidence upload.
      for (const [index, fileId] of files.entries())
        await tx.insert(s.taskProofFiles).values({
          proofId: created!.id,
          fileId,
          position: index + 1,
        });
      return created!;
    });
  }

  async decide(user: string, proofId: string, input: unknown) {
    parse(id, proofId);
    const value = parse(decisionInput, input);
    return this.run(user, async (tx, actor) => {
      const [proof] = await tx
        .select()
        .from(s.taskProofs)
        .where(eq(s.taskProofs.id, proofId));
      if (!proof) throw new NotFoundException();
      await this.claim(tx, proof.claimId, actor, true);
      const [existing] = await tx
        .select()
        .from(s.proofDecisions)
        .where(eq(s.proofDecisions.id, value.id));
      if (existing) {
        if (
          existing.proofId !== proofId ||
          existing.actorId !== actor ||
          existing.decision !== value.decision ||
          existing.reason !== value.reason
        )
          throw new ConflictException('Decision ID already used');
        return existing;
      }
      return (
        await tx
          .insert(s.proofDecisions)
          .values({ ...value, proofId, actorId: actor })
          .returning()
      )[0]!;
    });
  }

  async appeal(user: string, proofId: string, input: unknown) {
    parse(id, proofId);
    const value = parse(appealInput, input);
    return this.run(user, async (tx, actor) => {
      const [proof] = await tx
        .select()
        .from(s.taskProofs)
        .where(eq(s.taskProofs.id, proofId));
      if (!proof) throw new NotFoundException();
      await this.claim(tx, proof.claimId, actor);
      const [existing] = await tx
        .select()
        .from(s.taskAppeals)
        .where(eq(s.taskAppeals.id, value.id));
      if (existing) {
        if (existing.proofId !== proofId || existing.reason !== value.reason)
          throw new ConflictException('Appeal ID already used');
        return existing;
      }
      return (
        await tx
          .insert(s.taskAppeals)
          .values({ ...value, proofId })
          .returning()
      )[0]!;
    });
  }

  async resolve(user: string, appealId: string, input: unknown) {
    parse(id, appealId);
    const value = parse(resolutionInput, input);
    return this.run(user, async (tx, actor) => {
      const [grant] = await tx
        .select()
        .from(s.appealReviewerGrants)
        .where(
          and(
            eq(s.appealReviewerGrants.accountId, actor),
            isNull(s.appealReviewerGrants.revokedAt),
            sql`${s.appealReviewerGrants.expiresAt} > clock_timestamp()`,
          ),
        )
        .for('share');
      if (!grant)
        throw new ForbiddenException('Appeal review permission required');
      const [appeal] = await tx
        .select()
        .from(s.taskAppeals)
        .where(eq(s.taskAppeals.id, appealId))
        .for('update');
      if (!appeal) throw new NotFoundException();
      const [existing] = await tx
        .select()
        .from(s.appealResolutions)
        .where(eq(s.appealResolutions.id, value.id));
      if (existing) {
        if (
          existing.appealId !== appealId ||
          existing.actorId !== actor ||
          existing.decision !== value.decision ||
          existing.reason !== value.reason
        )
          throw new ConflictException('Resolution ID already used');
        return existing;
      }
      return (
        await tx
          .insert(s.appealResolutions)
          .values({ ...value, appealId, actorId: actor, grantId: grant.id })
          .returning()
      )[0]!;
    });
  }

  async acknowledge(user: string, proofId: string) {
    parse(id, proofId);
    return this.run(user, async (tx, actor) => {
      const [proof] = await tx
        .select()
        .from(s.taskProofs)
        .where(eq(s.taskProofs.id, proofId));
      if (!proof) throw new NotFoundException();
      await this.claim(tx, proof.claimId, actor);
      await tx
        .insert(s.proofDecisionReceipts)
        .values({ proofId })
        .onConflictDoNothing();
      return (
        await tx
          .select()
          .from(s.proofDecisionReceipts)
          .where(eq(s.proofDecisionReceipts.proofId, proofId))
      )[0]!;
    });
  }

  async readAppeal(user: string, appealId: string) {
    parse(id, appealId);
    return this.run(user, async (tx, actor) => {
      const [grant] = await tx
        .select({ id: s.appealReviewerGrants.id })
        .from(s.appealReviewerGrants)
        .where(
          and(
            eq(s.appealReviewerGrants.accountId, actor),
            isNull(s.appealReviewerGrants.revokedAt),
            sql`${s.appealReviewerGrants.expiresAt}>clock_timestamp()`,
          ),
        );
      if (!grant)
        throw new ForbiddenException('Appeal review permission required');
      const [row] = await tx
        .select({
          appeal: s.taskAppeals,
          proof: s.taskProofs,
          claim: s.taskClaims,
          task: s.sponsorTasks,
          owner: s.sponsorProfiles.ownerId,
        })
        .from(s.taskAppeals)
        .innerJoin(s.taskProofs, eq(s.taskProofs.id, s.taskAppeals.proofId))
        .innerJoin(s.taskClaims, eq(s.taskClaims.id, s.taskProofs.claimId))
        .innerJoin(s.sponsorTasks, eq(s.sponsorTasks.id, s.taskClaims.taskId))
        .innerJoin(
          s.sponsorProfiles,
          eq(s.sponsorProfiles.id, s.sponsorTasks.sponsorId),
        )
        .where(eq(s.taskAppeals.id, appealId));
      if (!row) throw new NotFoundException();
      if ([row.owner, row.claim.accountId].includes(actor))
        throw new ForbiddenException('Independent reviewer required');
      const history = await tx
        .select({ proof: s.taskProofs, decision: s.proofDecisions })
        .from(s.taskProofs)
        .leftJoin(
          s.proofDecisions,
          eq(s.proofDecisions.proofId, s.taskProofs.id),
        )
        .where(eq(s.taskProofs.claimId, row.claim.id))
        .orderBy(s.taskProofs.revision);
      const [resolution] = await tx
        .select()
        .from(s.appealResolutions)
        .where(eq(s.appealResolutions.appealId, appealId));
      const attached = await this.proofFiles(
        tx,
        history.map((h) => h.proof.id),
      );
      return {
        resolution: resolution ?? null,
        appeal: row.appeal,
        claim: row.claim,
        history: history.map((h) => ({
          ...h,
          files: attached.get(h.proof.id) ?? [],
        })),
        task: {
          ...row.task,
          rewardKobo: row.task.rewardKobo.toString(),
          budgetKobo: row.task.budgetKobo.toString(),
        },
      };
    });
  }

  // Files attached to proofs, by proof. Deleted files show as removed.
  private async proofFiles(tx: FundingDatabase, proofIds: string[]) {
    const byProof = new Map<
      string,
      { id: string; contentType: string; removed: boolean }[]
    >();
    if (!proofIds.length) return byProof;
    const found = await tx
      .select({
        proofId: s.taskProofFiles.proofId,
        id: s.files.id,
        contentType: s.files.contentType,
        removed: sql<boolean>`exists (select 1 from ${s.fileDeletions} d where d.file_id = ${s.files.id})`,
      })
      .from(s.taskProofFiles)
      .innerJoin(s.files, eq(s.files.id, s.taskProofFiles.fileId))
      .where(inArray(s.taskProofFiles.proofId, proofIds))
      .orderBy(s.taskProofFiles.position);
    for (const f of found) {
      const list = byProof.get(f.proofId) ?? [];
      list.push({ id: f.id, contentType: f.contentType, removed: f.removed });
      byProof.set(f.proofId, list);
    }
    return byProof;
  }

  async readClaim(user: string, claimId: string) {
    parse(id, claimId);
    return this.run(user, async (tx, actor) => {
      const [claim] = await tx
        .select()
        .from(s.taskClaims)
        .where(eq(s.taskClaims.id, claimId));
      if (!claim) throw new NotFoundException();
      // Sponsor or participant only. Admin reads require a separate explicit boundary.
      await this.claim(tx, claimId, actor, claim.accountId !== actor);
      const proofs = await tx
        .select({
          proof: s.taskProofs,
          decision: s.proofDecisions,
          receipt: s.proofDecisionReceipts,
          appeal: s.taskAppeals,
          resolution: s.appealResolutions,
        })
        .from(s.taskProofs)
        .leftJoin(
          s.proofDecisions,
          eq(s.proofDecisions.proofId, s.taskProofs.id),
        )
        .leftJoin(
          s.proofDecisionReceipts,
          eq(s.proofDecisionReceipts.proofId, s.taskProofs.id),
        )
        .leftJoin(s.taskAppeals, eq(s.taskAppeals.proofId, s.taskProofs.id))
        .leftJoin(
          s.appealResolutions,
          eq(s.appealResolutions.appealId, s.taskAppeals.id),
        )
        .where(eq(s.taskProofs.claimId, claimId))
        .orderBy(s.taskProofs.revision);
      const [task] = await tx
        .select()
        .from(s.sponsorTasks)
        .where(eq(s.sponsorTasks.id, claim.taskId));
      const attached = await this.proofFiles(
        tx,
        proofs.map((p) => p.proof.id),
      );
      return {
        claim,
        proofs: proofs.map((p) => ({
          ...p,
          files: attached.get(p.proof.id) ?? [],
        })),
        participant: claim.accountId === actor,
        observedAt: new Date().toISOString(),
        task: {
          title: task!.title,
          instructions: task!.instructions,
          proofRequirements: task!.proofRequirements,
          rejectionCriteria: task!.rejectionCriteria,
          endsAt: task!.endsAt,
          workTerms: task!.workTerms,
        },
      };
    });
  }
}
