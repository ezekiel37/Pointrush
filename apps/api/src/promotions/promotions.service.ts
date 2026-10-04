import { createHash, randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import * as s from '../database/schema.js';
import { actorTransaction } from '../tasks/actor-transaction.js';

// No 0/O, 1/I/L: printed codes are scratched, read and typed by hand.
const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const codeLength = 16;
export const failedClaimLimit = 10;
const id = z.uuid();
const batchInput = z
  .object({
    id,
    label: z.string().trim().min(1).max(80),
    size: z.number().int().min(1).max(5000),
  })
  .strict();
const revokeInput = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();
const claimInput = z
  .object({
    id,
    code: z
      .string()
      .max(40)
      .transform((v) =>
        v
          .toUpperCase()
          .replace(/[\s-]/g, '')
          .replace(/^AC(?=[A-HJKMNP-Z2-9]{16}$)/, ''),
      )
      .pipe(z.string().regex(/^[A-HJKMNP-Z2-9]{16}$/)),
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
  if (!result.success) throw new BadRequestException('Invalid promotion input');
  return result.data;
}
const fingerprint = (code: string) =>
  createHash('sha256').update(code).digest('hex');
export const displayClaimCode = (code: string) =>
  `AC-${code.match(/.{4}/g)!.join('-')}`;
function newCode() {
  return Array.from(
    { length: codeLength },
    () => alphabet[randomInt(alphabet.length)],
  ).join('');
}
function rejected(reason: string, message: string) {
  return new ConflictException({ statusCode: 409, message, reason });
}

// Prize promotions: the business distributes printed codes (by chance or one per
// pack); Acticlaim verifies each claim once and pays the prize from locked funds.
export class PromotionsService {
  constructor(private readonly db: FundingDatabase) {}

  private async ownedPromotion(
    tx: FundingDatabase,
    taskId: string,
    actor: string,
  ) {
    const [row] = await tx
      .select({ task: s.sponsorTasks })
      .from(s.sponsorTasks)
      .innerJoin(
        s.sponsorProfiles,
        eq(s.sponsorProfiles.id, s.sponsorTasks.sponsorId),
      )
      .where(
        and(
          eq(s.sponsorTasks.id, taskId),
          eq(s.sponsorProfiles.ownerId, actor),
          eq(s.sponsorTasks.model, 'claim_code'),
        ),
      );
    if (!row) throw new NotFoundException();
    return row.task;
  }

  private async ownedBatch(
    tx: FundingDatabase,
    batchId: string,
    actor: string,
  ) {
    const [row] = await tx
      .select({ batch: s.claimCodeBatches })
      .from(s.claimCodeBatches)
      .innerJoin(
        s.sponsorTasks,
        eq(s.sponsorTasks.id, s.claimCodeBatches.taskId),
      )
      .innerJoin(
        s.sponsorProfiles,
        eq(s.sponsorProfiles.id, s.sponsorTasks.sponsorId),
      )
      .where(
        and(
          eq(s.claimCodeBatches.id, batchId),
          eq(s.sponsorProfiles.ownerId, actor),
        ),
      );
    if (!row) throw new NotFoundException();
    return row.batch;
  }

  // Returns the plaintext codes exactly once. Only fingerprints are stored, so a
  // lost response cannot be recovered: revoke the batch and issue a new one.
  async createBatch(user: string, taskId: string, input: unknown) {
    parse(id, taskId);
    const value = parse(batchInput, input);
    return actorTransaction(this.db, user, async (tx, actor) => {
      await this.ownedPromotion(tx, taskId, actor);
      const [existing] = await tx
        .select({ id: s.claimCodeBatches.id })
        .from(s.claimCodeBatches)
        .where(eq(s.claimCodeBatches.id, value.id));
      if (existing)
        throw rejected(
          'batch_already_issued',
          'This batch was already issued and its codes cannot be shown again. Revoke it and issue a new batch if the codes were lost.',
        );
      await tx.insert(s.claimCodeBatches).values({
        id: value.id,
        taskId,
        actorId: actor,
        size: value.size,
        label: value.label,
      });
      const codes = new Set<string>();
      while (codes.size < value.size) codes.add(newCode());
      const list = [...codes];
      for (let i = 0; i < list.length; i += 1000)
        await tx.insert(s.claimCodes).values(
          list.slice(i, i + 1000).map((code) => ({
            batchId: value.id,
            taskId,
            codeHash: fingerprint(code),
          })),
        );
      return {
        batchId: value.id,
        label: value.label,
        codes: list.map(displayClaimCode),
      };
    });
  }

  async activateBatch(user: string, batchId: string) {
    parse(id, batchId);
    return actorTransaction(this.db, user, async (tx, actor) => {
      await this.ownedBatch(tx, batchId, actor);
      await tx
        .insert(s.claimBatchActivations)
        .values({ batchId, actorId: actor })
        .onConflictDoNothing();
      return { batchId, state: 'active' as const };
    });
  }

  async revokeBatch(user: string, batchId: string, input: unknown) {
    parse(id, batchId);
    const value = parse(revokeInput, input);
    return actorTransaction(this.db, user, async (tx, actor) => {
      await this.ownedBatch(tx, batchId, actor);
      await tx
        .insert(s.claimBatchRevocations)
        .values({ batchId, actorId: actor, reason: value.reason })
        .onConflictDoNothing();
      return { batchId, state: 'revoked' as const };
    });
  }

  private async claimant(user: string) {
    const [row] = await this.db
      .select({
        id: s.accounts.id,
        phone: sql<boolean>`exists (select 1 from ${s.verifiedPhones} where ${s.verifiedPhones.accountId} = ${s.accounts.id})`,
        failures: sql<number>`(select count(*)::integer from ${s.claimAttempts} where ${s.claimAttempts.accountId} = ${s.accounts.id} and not ${s.claimAttempts.succeeded} and ${s.claimAttempts.createdAt} > now() - interval '1 hour')`,
      })
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
    return row;
  }

  async claim(user: string, input: unknown) {
    const value = parse(claimInput, input);
    const person = await this.claimant(user);
    if (!person.phone)
      throw rejected(
        'phone_required',
        'Verify your phone number before claiming prizes.',
      );
    const [replay] = await this.db
      .select()
      .from(s.claimRedemptions)
      .where(eq(s.claimRedemptions.id, value.id));
    if (replay) {
      const [code] = await this.db
        .select({ codeHash: s.claimCodes.codeHash })
        .from(s.claimCodes)
        .where(eq(s.claimCodes.id, replay.codeId));
      if (
        replay.accountId !== person.id ||
        code?.codeHash !== fingerprint(value.code)
      )
        throw new ConflictException('Claim ID already used');
      return this.claimResult(replay.id);
    }
    if (person.failures >= failedClaimLimit)
      throw rejected(
        'claim_rate_limit',
        'Too many unsuccessful codes. Try again in an hour.',
      );
    try {
      const redemption = await actorTransaction(
        this.db,
        user,
        async (tx, actor) => {
          const [code] = await tx
            .select()
            .from(s.claimCodes)
            .where(eq(s.claimCodes.codeHash, fingerprint(value.code)));
          // Unknown, inactive, withdrawn and already-claimed codes look identical.
          if (!code)
            throw rejected('claim_rejected', 'This code cannot be claimed.');
          const [created] = await tx
            .insert(s.claimRedemptions)
            .values({
              id: value.id,
              codeId: code.id,
              taskId: code.taskId,
              accountId: actor,
            })
            .returning();
          return created!;
        },
      );
      await this.db
        .insert(s.claimAttempts)
        .values({ accountId: person.id, succeeded: true });
      return this.claimResult(redemption.id);
    } catch (error) {
      if (!(error instanceof HttpException) || error.getStatus() !== 409)
        throw error;
      await this.db
        .insert(s.claimAttempts)
        .values({ accountId: person.id, succeeded: false });
      const reason = (error.getResponse() as { reason?: string }).reason;
      if (reason === 'claim_limit')
        throw rejected(
          'claim_limit',
          'You have reached the claim limit for this promotion.',
        );
      throw rejected('claim_rejected', 'This code cannot be claimed.');
    }
  }

  private async claimResult(redemptionId: string) {
    const [row] = await this.db
      .select(this.claimFields())
      .from(s.claimRedemptions)
      .innerJoin(
        s.sponsorTasks,
        eq(s.sponsorTasks.id, s.claimRedemptions.taskId),
      )
      .innerJoin(
        s.sponsorProfiles,
        eq(s.sponsorProfiles.id, s.sponsorTasks.sponsorId),
      )
      .where(eq(s.claimRedemptions.id, redemptionId));
    return row!;
  }

  private claimFields() {
    return {
      id: s.claimRedemptions.id,
      taskId: s.claimRedemptions.taskId,
      title: s.sponsorTasks.title,
      businessName: s.sponsorProfiles.name,
      prizeKobo: sql<string>`${s.sponsorTasks.rewardKobo}::text`,
      claimedAt: s.claimRedemptions.createdAt,
    };
  }

  async claims(user: string, input: unknown = {}) {
    const query = parse(pageInput, input);
    const limit = query.limit ?? 25;
    return actorTransaction(this.db, user, async (tx, actor) => {
      const rows = await tx
        .select(this.claimFields())
        .from(s.claimRedemptions)
        .innerJoin(
          s.sponsorTasks,
          eq(s.sponsorTasks.id, s.claimRedemptions.taskId),
        )
        .innerJoin(
          s.sponsorProfiles,
          eq(s.sponsorProfiles.id, s.sponsorTasks.sponsorId),
        )
        .where(
          and(
            eq(s.claimRedemptions.accountId, actor),
            query.after ? lt(s.claimRedemptions.id, query.after) : undefined,
          ),
        )
        .orderBy(desc(s.claimRedemptions.id))
        .limit(limit + 1);
      return {
        items: rows.slice(0, limit),
        nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
      };
    });
  }

  async summary(user: string, taskId: string) {
    parse(id, taskId);
    return actorTransaction(this.db, user, async (tx, actor) => {
      const task = await this.ownedPromotion(tx, taskId, actor);
      // Single-table select: Drizzle omits table prefixes, so correlated
      // subqueries name claim_code_batches explicitly.
      const batches = await tx
        .select({
          id: s.claimCodeBatches.id,
          label: s.claimCodeBatches.label,
          size: s.claimCodeBatches.size,
          createdAt: s.claimCodeBatches.createdAt,
          active: sql<boolean>`exists (select 1 from claim_batch_activations a where a.batch_id = claim_code_batches.id)`,
          revoked: sql<boolean>`exists (select 1 from claim_batch_revocations v where v.batch_id = claim_code_batches.id)`,
          claimed: sql<number>`(select count(*)::integer from claim_redemptions r join claim_codes c on c.id = r.code_id where c.batch_id = claim_code_batches.id)`,
        })
        .from(s.claimCodeBatches)
        .where(eq(s.claimCodeBatches.taskId, taskId))
        .orderBy(s.claimCodeBatches.createdAt);
      const claimed = batches.reduce((sum, b) => sum + b.claimed, 0);
      const issued = batches.reduce(
        (sum, b) => sum + (b.revoked ? b.claimed : b.size),
        0,
      );
      return {
        taskId,
        title: task.title,
        prizeKobo: task.rewardKobo.toString(),
        prizes: task.capacity,
        promotionTerms: task.promotionTerms,
        claimed,
        issued,
        availableToIssue: task.capacity - issued,
        batches: batches.map((b) => ({
          ...b,
          state: b.revoked ? 'revoked' : b.active ? 'active' : 'issued',
        })),
      };
    });
  }
}
