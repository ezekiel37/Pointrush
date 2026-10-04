import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import * as s from '../database/schema.js';
import { actorTransaction } from '../tasks/actor-transaction.js';

// Provisional thresholds, counted in distinct businesses with settled activity.
// Points balance, spending and referrals never change a tier.
export const tiers = [
  { name: 'Gold', businesses: 25 },
  { name: 'Silver', businesses: 10 },
  { name: 'Bronze', businesses: 3 },
  { name: 'New', businesses: 0 },
] as const;
export type TierName = (typeof tiers)[number]['name'];

export function tierFor(businesses: number) {
  const index = tiers.findIndex((tier) => businesses >= tier.businesses);
  const current = tiers[index]!;
  const next = index > 0 ? tiers[index - 1]! : null;
  return {
    name: current.name as TierName,
    businesses,
    next: next && { name: next.name, businesses: next.businesses },
  };
}

const referInput = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9_]{1,18}[a-z0-9]$/),
  })
  .strict();
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
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('Invalid points input');
  return result.data;
}

// Distinct businesses where the account has a released purchase or a paid job.
export function settledBusinesses(account: string) {
  return sql<number>`(select count(distinct business)::integer from (
    select t.sponsor_id as business from ${s.purchaseConfirmations} p
      join ${s.purchaseReleases} r on r.confirmation_id = p.id
      join ${s.sponsorTasks} t on t.id = p.task_id
      where p.account_id = ${account}
    union
    select t.sponsor_id from ${s.taskClaims} c
      join ${s.fundingTransfers} f on f.kind = 'task_reward' and f.reference = 'claim:' || c.id::text
      join ${s.sponsorTasks} t on t.id = c.task_id
      where c.account_id = ${account}
  ) settled)`;
}

export class PointsService {
  constructor(private readonly db: FundingDatabase) {}

  async summary(user: string) {
    return actorTransaction(this.db, user, async (tx, actor) => {
      const [row] = await tx
        .select({
          available: sql<string>`coalesce(sum(${s.pointsEntries.points}) filter (where ${s.pointsEntries.availableAt} <= clock_timestamp()), 0)::text`,
          pending: sql<string>`coalesce(sum(${s.pointsEntries.points}) filter (where ${s.pointsEntries.availableAt} > clock_timestamp()), 0)::text`,
        })
        .from(s.pointsEntries)
        .where(eq(s.pointsEntries.accountId, actor));
      const [facts] = await tx
        .select({
          businesses: settledBusinesses(actor),
          phoneVerified: sql<boolean>`exists (select 1 from ${s.verifiedPhones} where ${s.verifiedPhones.accountId} = ${actor})`,
          username: sql<
            string | null
          >`(select ${s.usernames.username} from ${s.usernames} where ${s.usernames.accountId} = ${actor} and ${s.usernames.isCurrent})`,
          referredBy: sql<
            string | null
          >`(select u.username from ${s.referrals} r join ${s.usernames} u on u.account_id = r.referrer_id and u.is_current where r.referee_id = ${actor})`,
          referred: sql<number>`(select count(*)::integer from ${s.referrals} where ${s.referrals.referrerId} = ${actor})`,
          rewarded: sql<number>`(select count(*)::integer from ${s.pointsEntries} where ${s.pointsEntries.accountId} = ${actor} and ${s.pointsEntries.kind} = 'referral_referrer')`,
        })
        .from(s.accounts)
        .where(eq(s.accounts.id, actor));
      return {
        points: { available: row!.available, pending: row!.pending },
        tier: tierFor(facts!.businesses),
        phoneVerified: facts!.phoneVerified,
        referral: {
          code: facts!.username,
          referredBy: facts!.referredBy,
          referred: facts!.referred,
          rewarded: facts!.rewarded,
        },
      };
    });
  }

  async entries(user: string, input: unknown = {}) {
    const query = parse(pageInput, input);
    const limit = query.limit ?? 25;
    return actorTransaction(this.db, user, async (tx, actor) => {
      const rows = await tx
        .select({
          id: s.pointsEntries.id,
          kind: s.pointsEntries.kind,
          points: sql<string>`${s.pointsEntries.points}::text`,
          businessName: s.sponsorProfiles.name,
          availableAt: s.pointsEntries.availableAt,
          createdAt: s.pointsEntries.createdAt,
        })
        .from(s.pointsEntries)
        .leftJoin(
          s.sponsorProfiles,
          eq(s.sponsorProfiles.id, s.pointsEntries.businessId),
        )
        .where(
          and(
            eq(s.pointsEntries.accountId, actor),
            query.after ? lt(s.pointsEntries.id, query.after) : undefined,
          ),
        )
        .orderBy(desc(s.pointsEntries.id))
        .limit(limit + 1);
      return {
        items: rows.slice(0, limit),
        nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
      };
    });
  }

  // The new account names who referred it. Rewards come later, only after the
  // referee's own settled activity at a business the referrer does not own.
  async refer(user: string, input: unknown) {
    const value = parse(referInput, input);
    return actorTransaction(this.db, user, async (tx, actor) => {
      const [referrer] = await tx
        .select({ accountId: s.usernames.accountId })
        .from(s.usernames)
        .where(
          and(
            eq(s.usernames.username, value.username),
            eq(s.usernames.isCurrent, true),
          ),
        );
      if (!referrer?.accountId) throw new NotFoundException();
      const [existing] = await tx
        .select()
        .from(s.referrals)
        .where(eq(s.referrals.refereeId, actor));
      if (existing) {
        if (existing.referrerId !== referrer.accountId)
          throw new BadRequestException('A referrer is already recorded');
        return { referredBy: value.username, createdAt: existing.createdAt };
      }
      const [created] = await tx
        .insert(s.referrals)
        .values({ refereeId: actor, referrerId: referrer.accountId })
        .returning();
      return { referredBy: value.username, createdAt: created!.createdAt };
    });
  }
}
