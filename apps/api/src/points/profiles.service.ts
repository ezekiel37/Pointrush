import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import * as s from '../database/schema.js';
import { actorTransaction } from '../tasks/actor-transaction.js';
import { settledBusinesses, tierFor } from './points.service.js';

const visibilityInput = z.object({ public: z.boolean() }).strict();
const usernameInput = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{1,18}[a-z0-9]$/);

// A credibility profile derived only from settled platform records. Nothing on it
// is typed by its owner except the display name. Purchases are shown as a count
// only, never by business, because where someone shops is private.
export class ProfilesService {
  constructor(private readonly db: FundingDatabase) {}

  async setVisibility(user: string, input: unknown) {
    const parsed = visibilityInput.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid visibility');
    return actorTransaction(this.db, user, async (tx, actor) => {
      if (parsed.data.public)
        await tx
          .insert(s.publicProfiles)
          .values({ accountId: actor })
          .onConflictDoNothing();
      else
        await tx
          .delete(s.publicProfiles)
          .where(eq(s.publicProfiles.accountId, actor));
      return this.build(tx, actor);
    });
  }

  async own(user: string) {
    return actorTransaction(this.db, user, (tx, actor) =>
      this.build(tx, actor),
    );
  }

  // Missing, private and inactive profiles share one response.
  async publicProfile(username: string) {
    const parsed = usernameInput.safeParse(username);
    if (!parsed.success) throw new NotFoundException();
    const [row] = await this.db
      .select({ accountId: s.accounts.id })
      .from(s.usernames)
      .innerJoin(s.accounts, eq(s.accounts.id, s.usernames.accountId))
      .innerJoin(
        s.publicProfiles,
        eq(s.publicProfiles.accountId, s.accounts.id),
      )
      .where(
        and(
          eq(s.usernames.username, parsed.data),
          eq(s.usernames.isCurrent, true),
          eq(s.accounts.accessState, 'active'),
        ),
      );
    if (!row) throw new NotFoundException();
    const profile = await this.build(this.db, row.accountId);
    // The visibility flag is an owner setting, not part of the public page.
    return Object.fromEntries(
      Object.entries(profile).filter(([key]) => key !== 'public'),
    ) as Omit<typeof profile, 'public'>;
  }

  private async build(db: FundingDatabase, account: string) {
    const [facts] = await db
      .select({
        username: s.usernames.username,
        displayName: s.accountProfiles.displayName,
        memberSince: s.accounts.createdAt,
        public: sql<boolean>`exists (select 1 from ${s.publicProfiles} where ${s.publicProfiles.accountId} = ${account})`,
        phoneVerified: sql<boolean>`exists (select 1 from ${s.verifiedPhones} where ${s.verifiedPhones.accountId} = ${account})`,
        businesses: settledBusinesses(account),
        purchases: sql<number>`(select count(*)::integer from ${s.purchaseConfirmations} p join ${s.purchaseReleases} r on r.confirmation_id = p.id where p.account_id = ${account})`,
        jobs: sql<number>`(select count(*)::integer from ${s.taskClaims} c join ${s.fundingTransfers} f on f.kind = 'task_reward' and f.reference = 'claim:' || c.id::text where c.account_id = ${account})`,
        repeatClients: sql<number>`(select count(*)::integer from (select t.sponsor_id from ${s.taskClaims} c join ${s.fundingTransfers} f on f.kind = 'task_reward' and f.reference = 'claim:' || c.id::text join ${s.sponsorTasks} t on t.id = c.task_id where c.account_id = ${account} group by t.sponsor_id having count(*) > 1) repeat)`,
      })
      .from(s.accounts)
      .leftJoin(
        s.usernames,
        and(
          eq(s.usernames.accountId, s.accounts.id),
          eq(s.usernames.isCurrent, true),
        ),
      )
      .leftJoin(
        s.accountProfiles,
        eq(s.accountProfiles.accountId, s.accounts.id),
      )
      .where(eq(s.accounts.id, account));
    const work = await db
      .select({
        title: s.sponsorTasks.title,
        businessName: s.sponsorProfiles.name,
        completedAt: s.fundingTransfers.createdAt,
      })
      .from(s.taskClaims)
      .innerJoin(
        s.fundingTransfers,
        and(
          eq(s.fundingTransfers.kind, 'task_reward'),
          sql`${s.fundingTransfers.reference} = 'claim:' || ${s.taskClaims.id}::text`,
        ),
      )
      .innerJoin(s.sponsorTasks, eq(s.sponsorTasks.id, s.taskClaims.taskId))
      .innerJoin(
        s.sponsorProfiles,
        eq(s.sponsorProfiles.id, s.sponsorTasks.sponsorId),
      )
      .where(eq(s.taskClaims.accountId, account))
      .orderBy(desc(s.fundingTransfers.createdAt))
      .limit(20);
    return {
      username: facts!.username,
      displayName: facts!.displayName,
      memberSince: facts!.memberSince,
      public: facts!.public,
      tier: tierFor(facts!.businesses),
      verified: { email: true, phone: facts!.phoneVerified },
      stats: {
        businesses: facts!.businesses,
        jobsCompleted: facts!.jobs,
        repeatClients: facts!.repeatClients,
        purchases: facts!.purchases,
      },
      work,
    };
  }
}
