import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { accounts, authAccountLinks, authUsers } from '../database/schema.js';
import { fundingAccounts } from '../funding/funding.schema.js';
import {
  fundingBalance,
  postFundingTransfer,
} from '../funding/funding-ledger.js';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import { sponsorProfiles, sponsorTasks } from './sponsor.schema.js';
import {
  parseSponsorInput,
  sponsorInput,
  taskInput,
} from './sponsor.validation.js';

export class SponsorsService {
  constructor(
    private readonly database: { readonly db: FundingDatabase },
    private readonly termsVersion?: string,
  ) {}
  private get db() {
    return this.database.db;
  }

  private async owner(tx: FundingDatabase, authUserId: string) {
    const [owner] = await tx
      .select({ id: accounts.id, email: authUsers.email })
      .from(accounts)
      .innerJoin(authAccountLinks, eq(authAccountLinks.accountId, accounts.id))
      .innerJoin(authUsers, eq(authUsers.id, authAccountLinks.authUserId))
      .where(
        and(
          eq(authUsers.id, authUserId),
          eq(authUsers.emailVerified, true),
          eq(accounts.accessState, 'active'),
        ),
      )
      .for('update', { of: accounts });
    if (!owner)
      throw new ForbiddenException(
        'Complete account onboarding with verified email and active access',
      );
    return owner;
  }

  async createProfile(authUserId: string, input: unknown) {
    const value = parseSponsorInput(sponsorInput, input);
    if (!this.termsVersion)
      throw new ServiceUnavailableException(
        'Sponsor onboarding is not configured',
      );
    if (value.termsVersion !== this.termsVersion)
      throw new ConflictException('Accept the current sponsor terms');
    return this.db.transaction(async (tx) => {
      const owner = await this.owner(tx, authUserId);
      const [existing] = await tx
        .select()
        .from(sponsorProfiles)
        .where(eq(sponsorProfiles.ownerId, owner.id));
      if (existing) {
        if (
          existing.name !== value.name ||
          existing.termsVersion !== value.termsVersion
        )
          throw new ConflictException('Sponsor profile already exists');
        return existing;
      }
      const [profile] = await tx
        .insert(sponsorProfiles)
        .values({
          ownerId: owner.id,
          name: value.name,
          contactEmail: owner.email,
          termsVersion: value.termsVersion,
        })
        .returning();
      await tx
        .insert(fundingAccounts)
        .values({ ownerId: owner.id, bucket: 'available' })
        .onConflictDoNothing();
      return profile!;
    });
  }

  async getProfile(authUserId: string) {
    return this.db.transaction(async (tx) => {
      const owner = await this.owner(tx, authUserId);
      const [profile] = await tx
        .select()
        .from(sponsorProfiles)
        .where(eq(sponsorProfiles.ownerId, owner.id));
      if (!profile) throw new NotFoundException();
      return profile;
    });
  }

  async createTask(authUserId: string, input: unknown) {
    const value = parseSponsorInput(taskInput, input);
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify(value, (_key, item: unknown) =>
          typeof item === 'bigint' ? item.toString() : item,
        ),
      )
      .digest('hex');
    return this.db.transaction(async (tx) => {
      const owner = await this.owner(tx, authUserId);
      const [sponsor] = await tx
        .select()
        .from(sponsorProfiles)
        .where(eq(sponsorProfiles.ownerId, owner.id));
      if (!sponsor)
        throw new ForbiddenException('Sponsor onboarding is required');
      const [existing] = await tx
        .select()
        .from(sponsorTasks)
        .where(
          and(
            eq(sponsorTasks.sponsorId, sponsor.id),
            eq(sponsorTasks.requestId, value.requestId),
          ),
        );
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException(
            'Request ID was already used for different task terms',
          );
        return this.taskResult(existing);
      }
      if (!this.termsVersion || sponsor.termsVersion !== this.termsVersion)
        throw new ConflictException('Current sponsor terms are required');
      const [clock] = await tx
        .select({
          future: sql<boolean>`${value.startsAt.toISOString()}::timestamptz > clock_timestamp()`,
        })
        .from(sponsorProfiles)
        .where(eq(sponsorProfiles.id, sponsor.id));
      if (!clock?.future)
        throw new BadRequestException('Task start must be in the future');
      const [available] = await tx
        .select()
        .from(fundingAccounts)
        .where(
          and(
            eq(fundingAccounts.ownerId, owner.id),
            eq(fundingAccounts.bucket, 'available'),
          ),
        )
        .for('update');
      if (!available)
        throw new ConflictException('Sponsor funding account is unavailable');
      const budgetKobo = value.rewardKobo * BigInt(value.capacity);
      if ((await fundingBalance(tx, available.id)) < budgetKobo)
        throw new ConflictException('Insufficient available sponsor funds');
      const id = randomUUID();
      const [allocation] = await tx
        .insert(fundingAccounts)
        .values({ ownerId: owner.id, bucket: 'task_locked', allocationId: id })
        .returning();
      await postFundingTransfer(tx, {
        id: randomUUID(),
        sourceId: available.id,
        destinationId: allocation!.id,
        actorId: owner.id,
        amountKobo: budgetKobo,
        kind: 'task_lock',
        reference: `task:${id}:initial`,
        reason: 'Initial funded task creation',
      });
      const { requestId, ...terms } = value;
      const [task] = await tx
        .insert(sponsorTasks)
        .values({
          id,
          sponsorId: sponsor.id,
          requestId,
          requestHash,
          allocationAccountId: allocation!.id,
          ...terms,
          budgetKobo,
        })
        .returning();
      return this.taskResult(task!);
    });
  }

  async getTask(authUserId: string, id: string) {
    // IDs alone never grant access; missing and foreign tasks have the same response.
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new NotFoundException();
    return this.db.transaction(async (tx) => {
      const owner = await this.owner(tx, authUserId);
      const [row] = await tx
        .select({ task: sponsorTasks })
        .from(sponsorTasks)
        .innerJoin(
          sponsorProfiles,
          eq(sponsorProfiles.id, sponsorTasks.sponsorId),
        )
        .where(
          and(eq(sponsorTasks.id, id), eq(sponsorProfiles.ownerId, owner.id)),
        );
      if (!row) throw new NotFoundException();
      return this.taskResult(row.task);
    });
  }

  private taskResult(task: typeof sponsorTasks.$inferSelect) {
    return {
      id: task.id,
      sponsorId: task.sponsorId,
      requestId: task.requestId,
      allocationAccountId: task.allocationAccountId,
      title: task.title,
      workTerms: task.workTerms,
      instructions: task.instructions,
      proofRequirements: task.proofRequirements,
      rejectionCriteria: task.rejectionCriteria,
      model: task.model,
      capacity: task.capacity,
      startsAt: task.startsAt,
      endsAt: task.endsAt,
      reviewState: task.reviewState,
      termsVersion: task.termsVersion,
      lifecycle: task.lifecycle,
      createdAt: task.createdAt,
      rewardKobo: task.rewardKobo.toString(),
      budgetKobo: task.budgetKobo.toString(),
      fundingState: 'locked' as const,
    };
  }
}
