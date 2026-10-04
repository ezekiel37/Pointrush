import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import * as s from '../database/schema.js';

const pageInput = z
  .object({
    after: z.uuid().optional(),
    limit: z
      .string()
      .regex(/^[1-9][0-9]?$/)
      .transform(Number)
      .pipe(z.number().max(50))
      .optional(),
  })
  .strict();
const discoveryInput = pageInput.extend({
  q: z.string().trim().max(100).optional(),
});
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('Invalid list query');
  return parsed.data;
}
function page<T extends { id: string }>(rows: T[], limit: number) {
  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
  };
}

// Read-only projections kept separate from the transactional work commands.
export class TaskQueriesService {
  constructor(private readonly db: FundingDatabase) {}
  private async actor(user: string) {
    const [row] = await this.db
      .select({ id: s.accounts.id })
      .from(s.accounts)
      .innerJoin(
        s.authAccountLinks,
        eq(s.authAccountLinks.accountId, s.accounts.id),
      )
      .innerJoin(s.authUsers, eq(s.authUsers.id, s.authAccountLinks.authUserId))
      .where(
        and(
          eq(s.authUsers.id, user),
          eq(s.authUsers.emailVerified, true),
          eq(s.accounts.accessState, 'active'),
        ),
      );
    if (!row) throw new ForbiddenException('Active linked account required');
    return row.id;
  }
  async appeals(user: string, input: unknown = {}) {
    const query = parse(pageInput, input);
    const actor = await this.actor(user);
    const [grant] = await this.db
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
    const limit = query.limit ?? 25;
    const rows = await this.db
      .select({
        id: s.taskAppeals.id,
        title: s.sponsorTasks.title,
        createdAt: s.taskAppeals.createdAt,
        taskId: s.sponsorTasks.id,
      })
      .from(s.taskAppeals)
      .innerJoin(s.taskProofs, eq(s.taskProofs.id, s.taskAppeals.proofId))
      .innerJoin(s.taskClaims, eq(s.taskClaims.id, s.taskProofs.claimId))
      .innerJoin(s.sponsorTasks, eq(s.sponsorTasks.id, s.taskClaims.taskId))
      .innerJoin(
        s.sponsorProfiles,
        eq(s.sponsorProfiles.id, s.sponsorTasks.sponsorId),
      )
      .leftJoin(
        s.appealResolutions,
        eq(s.appealResolutions.appealId, s.taskAppeals.id),
      )
      .where(
        and(
          isNull(s.appealResolutions.id),
          ne(s.taskClaims.accountId, actor),
          ne(s.sponsorProfiles.ownerId, actor),
          query.after ? gt(s.taskAppeals.id, query.after) : undefined,
        ),
      )
      .orderBy(s.taskAppeals.id)
      .limit(limit + 1);
    return page(rows, limit);
  }
  async discover(user: string, input: unknown = {}) {
    const query = parse(discoveryInput, input);
    await this.actor(user);
    const limit = query.limit ?? 25;
    const rows = await this.db
      .select({
        id: s.sponsorTasks.id,
        title: s.sponsorTasks.title,
        businessName: s.sponsorProfiles.name,
        startsAt: s.sponsorTasks.startsAt,
        endsAt: s.sponsorTasks.endsAt,
        capacity: s.sponsorTasks.capacity,
        rewardBackingKobo: sql<string>`${s.sponsorTasks.rewardKobo}::text`,
        model: s.sponsorTasks.model,
        campaignTerms: s.sponsorTasks.campaignTerms,
        // Campaign places are consumed by confirmed, unvoided purchases.
        claimed: sql<number>`case when ${s.sponsorTasks.model}='purchase_cashback' then (select count(*)::integer from ${s.purchaseConfirmations} p where p.task_id=${s.sponsorTasks.id} and not exists (select 1 from ${s.purchaseVoids} v where v.confirmation_id=p.id)) else (select count(*)::integer from ${s.taskClaims} where ${s.taskClaims.taskId}=${s.sponsorTasks.id}) end`,
      })
      .from(s.sponsorTasks)
      .innerJoin(
        s.sponsorProfiles,
        eq(s.sponsorProfiles.id, s.sponsorTasks.sponsorId),
      )
      .innerJoin(s.accounts, eq(s.accounts.id, s.sponsorProfiles.ownerId))
      .where(
        and(
          eq(s.sponsorTasks.lifecycle, 'published'),
          eq(s.sponsorTasks.reviewState, 'approved'),
          eq(s.accounts.accessState, 'active'),
          sql`${s.sponsorTasks.endsAt}>clock_timestamp()`,
          query.after ? gt(s.sponsorTasks.id, query.after) : undefined,
          query.q
            ? sql`strpos(lower(${s.sponsorTasks.title}),lower(${query.q}))>0`
            : undefined,
        ),
      )
      .orderBy(s.sponsorTasks.id)
      .limit(limit + 1);
    return page(rows, limit);
  }
  async mine(user: string, input: unknown = {}) {
    const query = parse(pageInput, input);
    const actor = await this.actor(user);
    const limit = query.limit ?? 25;
    const rows = await this.db
      .select(claimFields)
      .from(s.taskClaims)
      .innerJoin(s.sponsorTasks, eq(s.sponsorTasks.id, s.taskClaims.taskId))
      .where(
        and(
          eq(s.taskClaims.accountId, actor),
          query.after ? gt(s.taskClaims.id, query.after) : undefined,
        ),
      )
      .orderBy(s.taskClaims.id)
      .limit(limit + 1);
    return page(rows, limit);
  }
  async sponsorTasks(user: string, input: unknown = {}) {
    const query = parse(pageInput, input);
    const actor = await this.actor(user);
    const limit = query.limit ?? 25;
    const rows = await this.db
      .select({
        id: s.sponsorTasks.id,
        title: s.sponsorTasks.title,
        reviewState: s.sponsorTasks.reviewState,
        lifecycle: s.sponsorTasks.lifecycle,
        endsAt: s.sponsorTasks.endsAt,
        budgetKobo: sql<string>`${s.sponsorTasks.budgetKobo}::text`,
      })
      .from(s.sponsorTasks)
      .innerJoin(
        s.sponsorProfiles,
        eq(s.sponsorProfiles.id, s.sponsorTasks.sponsorId),
      )
      .where(
        and(
          eq(s.sponsorProfiles.ownerId, actor),
          query.after ? gt(s.sponsorTasks.id, query.after) : undefined,
        ),
      )
      .orderBy(s.sponsorTasks.id)
      .limit(limit + 1);
    return page(rows, limit);
  }
  async participants(user: string, taskId: string, input: unknown = {}) {
    if (!z.uuid().safeParse(taskId).success)
      throw new BadRequestException('Invalid task identifier');
    const query = parse(pageInput, input);
    const actor = await this.actor(user);
    const limit = query.limit ?? 25;
    const [task] = await this.db
      .select({ id: s.sponsorTasks.id })
      .from(s.sponsorTasks)
      .innerJoin(
        s.sponsorProfiles,
        eq(s.sponsorProfiles.id, s.sponsorTasks.sponsorId),
      )
      .where(
        and(
          eq(s.sponsorTasks.id, taskId),
          eq(s.sponsorProfiles.ownerId, actor),
        ),
      );
    if (!task) throw new NotFoundException();
    const rows = await this.db
      .select(claimFields)
      .from(s.taskClaims)
      .innerJoin(s.sponsorTasks, eq(s.sponsorTasks.id, s.taskClaims.taskId))
      .where(
        and(
          eq(s.taskClaims.taskId, taskId),
          query.after ? gt(s.taskClaims.id, query.after) : undefined,
        ),
      )
      .orderBy(s.taskClaims.id)
      .limit(limit + 1);
    return page(rows, limit);
  }
}
const claimFields = {
  id: s.taskClaims.id,
  taskId: s.taskClaims.taskId,
  title: s.sponsorTasks.title,
  joinedAt: s.taskClaims.createdAt,
  endsAt: s.sponsorTasks.endsAt,
  latestProofId: sql<
    string | null
  >`(select id from ${s.taskProofs} where ${s.taskProofs.claimId}=${s.taskClaims.id} order by revision desc limit 1)`,
  approvedBackingKobo: sql<string>`coalesce((select amount_kobo::text from ${s.fundingTransfers} where kind='task_reward' and reference='claim:' || ${s.taskClaims.id}::text),'0')`,
};
