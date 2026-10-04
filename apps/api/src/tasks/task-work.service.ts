import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import * as s from '../database/schema.js';

const id = z.uuid();
const reason = z.string().trim().min(1).max(2000);
const proofInput = z
  .object({
    id,
    revision: z.number().int().min(1).max(2),
    evidence: z.string().trim().min(1).max(10000),
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

  private async run<T>(
    authUserId: string,
    action: (tx: FundingDatabase, actor: string) => Promise<T>,
  ) {
    try {
      return await this.db.transaction(async (tx) => {
        const [actor] = await tx
          .select({ id: s.accounts.id })
          .from(s.accounts)
          .innerJoin(
            s.authAccountLinks,
            eq(s.authAccountLinks.accountId, s.accounts.id),
          )
          .innerJoin(
            s.authUsers,
            eq(s.authUsers.id, s.authAccountLinks.authUserId),
          )
          .where(
            and(
              eq(s.authUsers.id, authUserId),
              eq(s.authUsers.emailVerified, true),
              eq(s.accounts.accessState, 'active'),
            ),
          )
          .for('share', { of: s.accounts });
        if (!actor)
          throw new ForbiddenException('Active linked account required');
        return action(tx, actor.id);
      });
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined;
      const code =
        (cause as { code?: string })?.code ??
        (error as { code?: string })?.code;
      if (['23514', '23505', '23503'].includes(code ?? ''))
        throw new ConflictException(
          'Task state changed or command is not eligible; reload current details',
        );
      throw error;
    }
  }

  async readTask(user: string, taskId: string) {
    parse(id, taskId);
    return this.run(user, async (tx) => {
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
      const [count] = await tx
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
        rewardBackingKobo: task.rewardKobo.toString(),
        capacity: task.capacity,
        claimed: count!.used,
        termsVersion: task.termsVersion,
      };
    });
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
      return (
        await tx
          .insert(s.taskProofs)
          .values({ ...value, claimId })
          .returning()
      )[0]!;
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
      return {
        resolution: resolution ?? null,
        appeal: row.appeal,
        claim: row.claim,
        history,
        task: {
          ...row.task,
          rewardKobo: row.task.rewardKobo.toString(),
          budgetKobo: row.task.budgetKobo.toString(),
        },
      };
    });
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
      return {
        claim,
        proofs,
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
