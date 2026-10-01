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

// Deliberately not registered in any HTTP module. A future admin boundary must
// establish a real, recent MFA session before deriving this account identity.
export class TaskReviewService {
  constructor(private readonly db: FundingDatabase) {}
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
