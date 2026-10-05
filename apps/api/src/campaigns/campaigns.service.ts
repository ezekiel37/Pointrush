import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import * as s from '../database/schema.js';
import { actorTransaction } from '../tasks/actor-transaction.js';

// No 0/O, 1/I/L: codes are read aloud and typed at busy tills.
const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const codeLength = 10;
const id = z.uuid();
const codeInput = z
  .string()
  .transform((v) => v.toUpperCase().replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^[A-HJKMNP-Z2-9]{10}$/));
const confirmInput = z
  .object({
    id,
    code: codeInput,
    amountKobo: z
      .string()
      .regex(/^[1-9][0-9]{0,14}$/)
      .transform(BigInt),
  })
  .strict();
const voidInput = z
  .object({ reason: z.string().trim().min(1).max(500) })
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
  if (!result.success) throw new BadRequestException('Invalid campaign input');
  return result.data;
}
function newCode() {
  return Array.from(
    { length: codeLength },
    () => alphabet[randomInt(alphabet.length)],
  ).join('');
}
export const displayCode = (code: string) =>
  `${code.slice(0, 5)}-${code.slice(5)}`;

type PurchaseState = 'pending' | 'releasable' | 'released' | 'voided';
function purchaseState(row: {
  releaseAt: Date;
  voided: boolean;
  released: boolean;
  observedAt: Date;
}): PurchaseState {
  if (row.released) return 'released';
  if (row.voided) return 'voided';
  return row.observedAt >= row.releaseAt ? 'releasable' : 'pending';
}

// Purchase campaigns: a business pays cash back from its own locked funds for
// purchases it confirms at the till. All eligibility rules are enforced again by
// database triggers; these checks only give clearer responses.
export class CampaignsService {
  constructor(private readonly db: FundingDatabase) {}

  // The till: the owner or an active staff member of the business.
  private async tillCampaign(
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
          eq(s.sponsorTasks.model, 'purchase_cashback'),
          sql`(${s.sponsorProfiles.ownerId} = ${actor} or business_staff_active(${s.sponsorProfiles.id}, ${actor}))`,
        ),
      );
    if (!row) throw new NotFoundException();
    return row.task;
  }

  async activate(user: string, taskId: string) {
    parse(id, taskId);
    return actorTransaction(this.db, user, async (tx, actor) => {
      // Reuse a live, unused code so repeated taps do not mint new ones.
      const [live] = await tx
        .select()
        .from(s.purchaseCodes)
        .leftJoin(
          s.purchaseConfirmations,
          eq(s.purchaseConfirmations.codeId, s.purchaseCodes.id),
        )
        .where(
          and(
            eq(s.purchaseCodes.taskId, taskId),
            eq(s.purchaseCodes.accountId, actor),
            isNull(s.purchaseConfirmations.id),
            sql`${s.purchaseCodes.expiresAt} > clock_timestamp() + interval '2 minutes'`,
          ),
        )
        .orderBy(desc(s.purchaseCodes.expiresAt))
        .limit(1);
      const code =
        live?.purchase_codes ??
        (
          await tx
            .insert(s.purchaseCodes)
            .values({
              taskId,
              accountId: actor,
              code: newCode(),
              // Replaced by the database clock.
              expiresAt: new Date(),
            })
            .returning()
        )[0]!;
      return {
        taskId,
        code: code.code,
        display: displayCode(code.code),
        expiresAt: code.expiresAt,
      };
    });
  }

  async confirm(user: string, taskId: string, input: unknown) {
    parse(id, taskId);
    const value = parse(confirmInput, input);
    return actorTransaction(this.db, user, async (tx, actor) => {
      const task = await this.tillCampaign(tx, taskId, actor);
      const [existing] = await tx
        .select({
          confirmation: s.purchaseConfirmations,
          code: s.purchaseCodes.code,
        })
        .from(s.purchaseConfirmations)
        .innerJoin(
          s.purchaseCodes,
          eq(s.purchaseCodes.id, s.purchaseConfirmations.codeId),
        )
        .where(eq(s.purchaseConfirmations.id, value.id));
      if (existing) {
        if (
          existing.confirmation.taskId !== taskId ||
          existing.code !== value.code ||
          existing.confirmation.amountKobo !== value.amountKobo
        )
          throw new ConflictException('Confirmation ID already used');
        return this.confirmationResult(existing.confirmation, task.rewardKobo);
      }
      const [code] = await tx
        .select()
        .from(s.purchaseCodes)
        .where(
          and(
            eq(s.purchaseCodes.code, value.code),
            eq(s.purchaseCodes.taskId, taskId),
          ),
        );
      // Unknown, foreign-campaign and expired codes share one response.
      if (!code)
        throw new ConflictException({
          statusCode: 409,
          message: 'This code is not valid for this campaign',
          reason: 'confirmation_rejected',
        });
      const [created] = await tx
        .insert(s.purchaseConfirmations)
        .values({
          id: value.id,
          codeId: code.id,
          taskId,
          accountId: code.accountId,
          actorId: actor,
          amountKobo: value.amountKobo,
          // Replaced by the database clock and the reviewed hold.
          releaseAt: new Date(),
        })
        .returning();
      return this.confirmationResult(created!, task.rewardKobo);
    });
  }

  private confirmationResult(
    row: typeof s.purchaseConfirmations.$inferSelect,
    rewardKobo: bigint,
  ) {
    return {
      id: row.id,
      taskId: row.taskId,
      amountKobo: row.amountKobo.toString(),
      cashbackKobo: rewardKobo.toString(),
      releaseAt: row.releaseAt,
      createdAt: row.createdAt,
    };
  }

  async voidPurchase(user: string, confirmationId: string, input: unknown) {
    parse(id, confirmationId);
    const value = parse(voidInput, input);
    return actorTransaction(this.db, user, async (tx, actor) => {
      const [row] = await tx
        .select({ confirmation: s.purchaseConfirmations })
        .from(s.purchaseConfirmations)
        .innerJoin(
          s.sponsorTasks,
          eq(s.sponsorTasks.id, s.purchaseConfirmations.taskId),
        )
        .innerJoin(
          s.sponsorProfiles,
          eq(s.sponsorProfiles.id, s.sponsorTasks.sponsorId),
        )
        .where(
          and(
            eq(s.purchaseConfirmations.id, confirmationId),
            eq(s.sponsorProfiles.ownerId, actor),
          ),
        );
      if (!row) throw new NotFoundException();
      const [existing] = await tx
        .select()
        .from(s.purchaseVoids)
        .where(eq(s.purchaseVoids.confirmationId, confirmationId));
      if (existing) {
        if (existing.reason !== value.reason)
          throw new ConflictException('Purchase was already voided');
        return existing;
      }
      return (
        await tx
          .insert(s.purchaseVoids)
          .values({ confirmationId, actorId: actor, reason: value.reason })
          .returning()
      )[0]!;
    });
  }

  async release(user: string, confirmationId: string) {
    parse(id, confirmationId);
    return actorTransaction(this.db, user, async (tx, actor) => {
      const [row] = await tx
        .select()
        .from(s.purchaseConfirmations)
        .where(
          and(
            eq(s.purchaseConfirmations.id, confirmationId),
            eq(s.purchaseConfirmations.accountId, actor),
          ),
        );
      if (!row) throw new NotFoundException();
      await tx
        .insert(s.purchaseReleases)
        .values({ confirmationId })
        .onConflictDoNothing();
      const [transfer] = await tx
        .select({ amountKobo: s.fundingTransfers.amountKobo })
        .from(s.fundingTransfers)
        .where(
          and(
            eq(s.fundingTransfers.kind, 'purchase_cashback'),
            eq(s.fundingTransfers.reference, `purchase:${confirmationId}`),
          ),
        );
      return {
        confirmationId,
        state: 'released' as const,
        cashbackKobo: transfer!.amountKobo.toString(),
      };
    });
  }

  // Returns unused campaign money to the business; the database decides how
  // much (everything before publication, the unowed remainder after the end).
  async returnFunds(user: string, taskId: string, input: unknown) {
    parse(id, taskId);
    const value = parse(z.object({ id: z.uuid() }).strict(), input);
    return actorTransaction(this.db, user, async (tx, actor) => {
      const [existing] = await tx
        .select()
        .from(s.campaignReturns)
        .where(eq(s.campaignReturns.id, value.id));
      if (existing) {
        if (existing.taskId !== taskId || existing.actorId !== actor)
          throw new NotFoundException();
      } else {
        const [owned] = await tx
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
        if (!owned) throw new NotFoundException();
        await tx
          .insert(s.campaignReturns)
          .values({ id: value.id, taskId, actorId: actor });
      }
      const [row] = await tx
        .select()
        .from(s.campaignReturns)
        .where(eq(s.campaignReturns.id, value.id));
      return {
        id: row!.id,
        taskId,
        amountKobo: row!.amountKobo.toString(),
        createdAt: row!.createdAt,
      };
    });
  }

  async purchases(user: string, input: unknown = {}) {
    const query = parse(pageInput, input);
    const limit = query.limit ?? 25;
    return actorTransaction(this.db, user, async (tx, actor) => {
      const rows = await tx
        .select(this.purchaseFields())
        .from(s.purchaseConfirmations)
        .innerJoin(
          s.sponsorTasks,
          eq(s.sponsorTasks.id, s.purchaseConfirmations.taskId),
        )
        .innerJoin(
          s.sponsorProfiles,
          eq(s.sponsorProfiles.id, s.sponsorTasks.sponsorId),
        )
        .where(
          and(
            eq(s.purchaseConfirmations.accountId, actor),
            query.after
              ? lt(s.purchaseConfirmations.id, query.after)
              : undefined,
          ),
        )
        .orderBy(desc(s.purchaseConfirmations.id))
        .limit(limit + 1);
      return this.purchasePage(rows, limit);
    });
  }

  async summary(user: string, taskId: string, input: unknown = {}) {
    parse(id, taskId);
    const query = parse(pageInput, input);
    const limit = query.limit ?? 25;
    return actorTransaction(this.db, user, async (tx, actor) => {
      const task = await this.tillCampaign(tx, taskId, actor);
      const [counts] = await tx
        .select({
          confirmed: sql<number>`count(*)::integer`,
          voided: sql<number>`count(${s.purchaseVoids.confirmationId})::integer`,
          released: sql<number>`count(${s.purchaseReleases.confirmationId})::integer`,
          // Shoppers who came back after their first confirmed purchase here.
          returning: sql<number>`count(distinct ${s.purchaseConfirmations.accountId}) filter (where exists (select 1 from ${s.purchaseConfirmations} later join ${s.sponsorTasks} later_task on later_task.id = later.task_id where later.account_id = ${s.purchaseConfirmations.accountId} and later_task.sponsor_id = ${task.sponsorId} and later.created_at > ${s.purchaseConfirmations.createdAt}))::integer`,
        })
        .from(s.purchaseConfirmations)
        .leftJoin(
          s.purchaseVoids,
          eq(s.purchaseVoids.confirmationId, s.purchaseConfirmations.id),
        )
        .leftJoin(
          s.purchaseReleases,
          eq(s.purchaseReleases.confirmationId, s.purchaseConfirmations.id),
        )
        .where(eq(s.purchaseConfirmations.taskId, taskId));
      const rows = await tx
        .select(this.purchaseFields())
        .from(s.purchaseConfirmations)
        .innerJoin(
          s.sponsorTasks,
          eq(s.sponsorTasks.id, s.purchaseConfirmations.taskId),
        )
        .innerJoin(
          s.sponsorProfiles,
          eq(s.sponsorProfiles.id, s.sponsorTasks.sponsorId),
        )
        .where(
          and(
            eq(s.purchaseConfirmations.taskId, taskId),
            query.after
              ? lt(s.purchaseConfirmations.id, query.after)
              : undefined,
          ),
        )
        .orderBy(desc(s.purchaseConfirmations.id))
        .limit(limit + 1);
      const active = counts!.confirmed - counts!.voided;
      return {
        taskId,
        title: task.title,
        capacity: task.capacity,
        cashbackKobo: task.rewardKobo.toString(),
        budgetKobo: task.budgetKobo.toString(),
        campaignTerms: task.campaignTerms,
        confirmed: counts!.confirmed,
        voided: counts!.voided,
        released: counts!.released,
        remaining: Math.max(0, task.capacity - active),
        returningShoppers: counts!.returning,
        recent: this.purchasePage(rows, limit),
      };
    });
  }

  private purchaseFields() {
    return {
      id: s.purchaseConfirmations.id,
      taskId: s.purchaseConfirmations.taskId,
      title: s.sponsorTasks.title,
      businessName: s.sponsorProfiles.name,
      amountKobo: sql<string>`${s.purchaseConfirmations.amountKobo}::text`,
      cashbackKobo: sql<string>`${s.sponsorTasks.rewardKobo}::text`,
      releaseAt: s.purchaseConfirmations.releaseAt,
      createdAt: s.purchaseConfirmations.createdAt,
      voided: sql<boolean>`exists (select 1 from ${s.purchaseVoids} where ${s.purchaseVoids.confirmationId} = ${s.purchaseConfirmations.id})`,
      released: sql<boolean>`exists (select 1 from ${s.purchaseReleases} where ${s.purchaseReleases.confirmationId} = ${s.purchaseConfirmations.id})`,
      observedAt: sql<Date>`clock_timestamp()`.mapWith(
        (v: string) => new Date(v),
      ),
    };
  }

  private purchasePage<
    T extends {
      id: string;
      releaseAt: Date;
      voided: boolean;
      released: boolean;
      observedAt: Date;
    },
  >(rows: T[], limit: number) {
    return {
      items: rows.slice(0, limit).map(({ observedAt, ...row }) => ({
        ...row,
        state: purchaseState({ ...row, observedAt }),
      })),
      nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
      observedAt: rows[0]?.observedAt ?? new Date(),
    };
  }
}
