import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { accounts } from '../database/schema.js';
import { sponsorProfiles, sponsorTasks } from '../sponsors/sponsor.schema.js';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import { taskReviewerGrants, taskReviews } from './task-review.schema.js';

const inputSchema = z
  .object({
    requestId: z.uuid(),
    taskId: z.uuid(),
    termsVersion: z.number().int().positive(),
    termsHash: z.string().regex(/^[0-9a-f]{64}$/),
    decision: z.enum(['approved', 'changes_required', 'rejected']),
    reason: z.string().trim().min(1).max(2000),
    checklist: z
      .object({
        permittedObjective: z.boolean(),
        clearInstructions: z.boolean(),
        feasibleProof: z.boolean(),
        fairRewardTerms: z.boolean(),
        safeDestinations: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (value) =>
      value.decision !== 'approved' ||
      Object.values(value.checklist).every(Boolean),
  );

// HTTP callers still require a real, recent MFA session; grant checks remain
// inside this service so the authorization boundary is not controller-only.
export class TaskReviewService {
  constructor(private readonly db: FundingDatabase) {}

  private async assertReviewer(reviewerId: string) {
    if (!z.uuid().safeParse(reviewerId).success)
      throw new BadRequestException('Invalid reviewer identity');
    const [grant] = await this.db
      .select({ id: taskReviewerGrants.id })
      .from(taskReviewerGrants)
      .innerJoin(accounts, eq(accounts.id, taskReviewerGrants.reviewerId))
      .where(
        and(
          eq(accounts.id, reviewerId),
          eq(accounts.accessState, 'active'),
          isNull(taskReviewerGrants.revokedAt),
          sql`${taskReviewerGrants.expiresAt} > clock_timestamp()`,
        ),
      );
    if (!grant) throw new ForbiddenException('Task review permission required');
  }

  async listPending(reviewerId: string, query: unknown = {}) {
    const parsed = z
      .object({
        after: z.uuid().optional(),
        limit: z
          .string()
          .regex(/^[1-9][0-9]?$/)
          .transform(Number)
          .pipe(z.number().max(50))
          .optional(),
      })
      .strict()
      .safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid review query');
    await this.assertReviewer(reviewerId);
    const limit = parsed.data.limit ?? 25;
    const rows = await this.db
      .select(reviewFields)
      .from(sponsorTasks)
      .innerJoin(
        sponsorProfiles,
        eq(sponsorProfiles.id, sponsorTasks.sponsorId),
      )
      .where(
        and(
          eq(sponsorTasks.reviewState, 'pending_review'),
          parsed.data.after
            ? sql`${sponsorTasks.id} > ${parsed.data.after}::uuid`
            : undefined,
        ),
      )
      .orderBy(sponsorTasks.id)
      .limit(limit + 1);
    return {
      items: rows.slice(0, limit).map(reviewResult),
      nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
    };
  }

  async getPending(reviewerId: string, taskId: string) {
    if (!z.uuid().safeParse(taskId).success)
      throw new BadRequestException('Invalid task identifier');
    await this.assertReviewer(reviewerId);
    const [task] = await this.db
      .select(reviewFields)
      .from(sponsorTasks)
      .innerJoin(
        sponsorProfiles,
        eq(sponsorProfiles.id, sponsorTasks.sponsorId),
      )
      .where(
        and(
          eq(sponsorTasks.id, taskId),
          eq(sponsorTasks.reviewState, 'pending_review'),
        ),
      );
    if (!task) throw new NotFoundException();
    return reviewResult(task);
  }

  async decide(reviewerId: string, input: unknown) {
    const parsed = inputSchema.safeParse(input);
    if (!z.uuid().safeParse(reviewerId).success || !parsed.success)
      throw new BadRequestException('Invalid review command');
    const value = parsed.data;
    const requestHash = createHash('sha256')
      .update(JSON.stringify(value))
      .digest('hex');
    return this.db.transaction(async (tx) => {
      // Account -> grant -> task is the consistent lock order. Revocation and
      // suspension serialize with a decision already in progress.
      const [reviewer] = await tx
        .select()
        .from(accounts)
        .where(
          and(eq(accounts.id, reviewerId), eq(accounts.accessState, 'active')),
        )
        .for('share');
      if (!reviewer)
        throw new ForbiddenException('Task review permission required');
      const [grant] = await tx
        .select()
        .from(taskReviewerGrants)
        .where(
          and(
            eq(taskReviewerGrants.reviewerId, reviewerId),
            isNull(taskReviewerGrants.revokedAt),
            sql`${taskReviewerGrants.expiresAt} > clock_timestamp()`,
          ),
        )
        .for('share');
      if (!grant)
        throw new ForbiddenException('Task review permission required');
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`review:${reviewerId}:${value.requestId}`}, 0))`,
      );
      const [existing] = await tx
        .select()
        .from(taskReviews)
        .where(
          and(
            eq(taskReviews.reviewerId, reviewerId),
            eq(taskReviews.requestId, value.requestId),
          ),
        );
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException(
            'Review request conflicts with its previous use',
          );
        return existing;
      }
      const [task] = await tx
        .select()
        .from(sponsorTasks)
        .where(eq(sponsorTasks.id, value.taskId))
        .for('update');
      if (!task) throw new NotFoundException();
      const [sponsor] = await tx
        .select()
        .from(sponsorProfiles)
        .where(eq(sponsorProfiles.id, task.sponsorId));
      if (sponsor!.ownerId === reviewerId)
        throw new ForbiddenException('You cannot review your own task');
      if (
        task.reviewState !== 'pending_review' ||
        task.termsVersion !== value.termsVersion ||
        task.requestHash !== value.termsHash
      )
        throw new ConflictException(
          'Task review is stale; reload the current terms',
        );
      const [review] = await tx
        .insert(taskReviews)
        .values({ ...value, reviewerId, grantId: grant.id, requestHash })
        .returning();
      // The database trigger validates the decision and changes review state in
      // this transaction. It never publishes or releases any locked funding.
      return review!;
    });
  }
}

const reviewFields = {
  workTerms: sponsorTasks.workTerms,
  campaignTerms: sponsorTasks.campaignTerms,
  promotionTerms: sponsorTasks.promotionTerms,
  id: sponsorTasks.id,
  sponsorId: sponsorTasks.sponsorId,
  sponsorName: sponsorProfiles.name,
  title: sponsorTasks.title,
  instructions: sponsorTasks.instructions,
  proofRequirements: sponsorTasks.proofRequirements,
  rejectionCriteria: sponsorTasks.rejectionCriteria,
  model: sponsorTasks.model,
  capacity: sponsorTasks.capacity,
  rewardKobo: sponsorTasks.rewardKobo,
  budgetKobo: sponsorTasks.budgetKobo,
  startsAt: sponsorTasks.startsAt,
  endsAt: sponsorTasks.endsAt,
  termsVersion: sponsorTasks.termsVersion,
  termsHash: sponsorTasks.requestHash,
  reviewState: sponsorTasks.reviewState,
};
function reviewResult<T extends { rewardKobo: bigint; budgetKobo: bigint }>(
  row: T,
) {
  return {
    ...row,
    rewardKobo: row.rewardKobo.toString(),
    budgetKobo: row.budgetKobo.toString(),
  };
}
