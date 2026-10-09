import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import * as s from '../database/schema.js';
import { actorTransaction } from '../tasks/actor-transaction.js';
import { safeErrorSummary } from '../database/safe-error.js';
import type { BillKind, BillProvider, Biller } from './provider.js';

const kind = z.enum(['airtime', 'data', 'electricity', 'tv']);
// Phone numbers in local form (0803…), meter and decoder numbers as digits.
const customerRef = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^[0-9]{10,13}$/));
const purchaseInput = z
  .object({
    id: z.uuid(),
    kind,
    biller: z.string().min(1).max(40),
    customerRef,
    planCode: z.string().min(1).max(60).optional(),
    amountKobo: z
      .string()
      .regex(/^[1-9][0-9]{0,9}$/)
      .transform(BigInt),
  })
  .strict();
const verifyInput = z
  .object({ kind, biller: z.string().min(1).max(40), customerRef })
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
const phone = /^0[789][01][0-9]{8}$/;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('Invalid bill input');
  return result.data;
}
const invalid = (reason: string, message: string) =>
  new BadRequestException({ statusCode: 400, message, reason });

// Airtime, data, electricity and TV paid from the reward wallet. The amount is
// held when the purchase is recorded, sent when the provider delivers, and
// returned to the wallet when it fails. Without a provider the feature is off.
export class BillsService {
  private catalogue?: { at: number; billers: Biller[] };

  constructor(
    private readonly db: FundingDatabase,
    private readonly provider?: BillProvider,
    private readonly now: () => number = Date.now,
  ) {}

  private requireProvider() {
    if (!this.provider)
      throw new ServiceUnavailableException({
        statusCode: 503,
        message: 'Bill payments are not available yet',
        reason: 'bills_unavailable',
      });
    return this.provider;
  }

  private async billers() {
    const provider = this.requireProvider();
    // Prices change rarely; refresh the catalogue every 10 minutes.
    if (!this.catalogue || this.now() - this.catalogue.at > 600000)
      this.catalogue = { at: this.now(), billers: await provider.billers() };
    return this.catalogue.billers;
  }

  async options() {
    if (!this.provider) return { available: false, billers: [] };
    const billers = await this.billers();
    return {
      available: true,
      minKobo: '5000',
      maxKobo: '5000000',
      billers: billers.map((b) => ({
        id: b.id,
        kind: b.kind,
        name: b.name,
        plans:
          b.plans?.map((p) => ({
            code: p.code,
            name: p.name,
            amountKobo: p.amountKobo.toString(),
          })) ?? null,
      })),
    };
  }

  private async checkPurchase(input: {
    kind: BillKind;
    biller: string;
    customerRef: string;
    planCode?: string;
    amountKobo?: bigint;
  }) {
    const biller = (await this.billers()).find(
      (b) => b.id === input.biller && b.kind === input.kind,
    );
    if (!biller) throw invalid('unknown_biller', 'Choose a listed biller');
    if (
      (input.kind === 'airtime' || input.kind === 'data') &&
      !phone.test(input.customerRef)
    )
      throw invalid('invalid_phone', 'Enter an 11-digit phone number');
    if (input.amountKobo === undefined) return biller;
    if (biller.plans) {
      // Bundles and packages cost exactly their listed price.
      const plan = biller.plans.find((p) => p.code === input.planCode);
      if (!plan || plan.amountKobo !== input.amountKobo)
        throw invalid('plan_changed', 'Choose a listed plan');
    } else if (input.planCode !== undefined) {
      throw invalid('plan_changed', 'This biller has no plans');
    }
    if (input.amountKobo < 5000n || input.amountKobo > 5000000n)
      throw invalid('amount_out_of_range', 'Between ₦50 and ₦50,000');
    return biller;
  }

  // The name the biller holds for a meter or decoder, so the person can check
  // it before paying.
  async verify(user: string, input: unknown) {
    const value = parse(verifyInput, input);
    const provider = this.requireProvider();
    await actorTransaction(this.db, user, () => Promise.resolve());
    if (value.kind !== 'electricity' && value.kind !== 'tv')
      throw invalid('nothing_to_verify', 'Only meters and decoders');
    await this.checkPurchase(value);
    try {
      return await provider.verifyCustomer(value);
    } catch (error) {
      process.stderr.write(
        JSON.stringify({
          level: 'warn',
          event: 'bill_verify_failed',
          cause: safeErrorSummary(error),
        }) + '\n',
      );
      throw new ConflictException({
        statusCode: 409,
        message: 'This number could not be checked',
        reason: 'customer_not_found',
      });
    }
  }

  async buy(user: string, input: unknown) {
    const provider = this.requireProvider();
    const value = parse(purchaseInput, input);
    await this.checkPurchase(value);
    // Record and hold first. The provider is called after the hold commits,
    // so money is never sent without a recorded purchase.
    await actorTransaction(this.db, user, async (tx, actor) => {
      const [existing] = await tx
        .select()
        .from(s.billPurchases)
        .where(eq(s.billPurchases.id, value.id));
      if (existing) {
        if (
          existing.accountId !== actor ||
          existing.amountKobo !== value.amountKobo ||
          existing.customerRef !== value.customerRef ||
          existing.biller !== value.biller
        )
          throw new ConflictException('Bill ID already used');
        return;
      }
      await tx.insert(s.billPurchases).values({
        id: value.id,
        accountId: actor,
        provider: provider.name,
        kind: value.kind,
        biller: value.biller,
        customerRef: value.customerRef,
        planCode: value.planCode ?? null,
        amountKobo: value.amountKobo,
      });
    });
    await this.settle(value.id);
    return actorTransaction(this.db, user, (tx, actor) =>
      this.result(tx, actor, value.id),
    );
  }

  // Asks the provider for a purchase's result and records it once. Safe to
  // repeat: the provider is idempotent on the bill ID and an outcome is final.
  async settle(billId: string) {
    const provider = this.requireProvider();
    const [bill] = await this.db
      .select()
      .from(s.billPurchases)
      .leftJoin(s.billOutcomes, eq(s.billOutcomes.billId, s.billPurchases.id))
      .where(eq(s.billPurchases.id, billId));
    if (!bill || bill.bill_outcomes) return;
    const b = bill.bill_purchases;
    let result;
    try {
      result = await provider.purchase({
        billId: b.id,
        kind: b.kind as BillKind,
        biller: b.biller,
        customerRef: b.customerRef,
        ...(b.planCode ? { planCode: b.planCode } : {}),
        amountKobo: b.amountKobo,
      });
    } catch (error) {
      // Unknown: the money stays held and the purchase is checked again.
      process.stderr.write(
        JSON.stringify({
          level: 'warn',
          event: 'bill_purchase_unknown',
          cause: safeErrorSummary(error),
        }) + '\n',
      );
      return;
    }
    if (result.status === 'pending') return;
    await this.db.transaction(async (tx) => {
      await tx
        .insert(s.billOutcomes)
        .values(
          result.status === 'delivered'
            ? {
                billId: b.id,
                outcome: 'delivered',
                providerRef: result.providerRef.slice(0, 120),
                token: result.token?.slice(0, 120) ?? null,
                reason: 'Delivered by the provider',
              }
            : {
                billId: b.id,
                outcome: 'failed',
                reason: result.reason.slice(0, 300) || 'Declined',
              },
        )
        .onConflictDoNothing();
    });
  }

  // For the inline worker: purchases still waiting for a result.
  async settlePending(limit = 25) {
    if (!this.provider) return { checked: 0 };
    const rows = await this.db
      .select({ id: s.billPurchases.id })
      .from(s.billPurchases)
      .leftJoin(s.billOutcomes, eq(s.billOutcomes.billId, s.billPurchases.id))
      .where(
        and(
          isNull(s.billOutcomes.billId),
          sql`${s.billPurchases.createdAt} < clock_timestamp() - interval '1 minute'`,
        ),
      )
      .orderBy(s.billPurchases.createdAt)
      .limit(limit);
    for (const row of rows) await this.settle(row.id);
    return { checked: rows.length };
  }

  private fields() {
    return {
      id: s.billPurchases.id,
      kind: s.billPurchases.kind,
      biller: s.billPurchases.biller,
      customerRef: s.billPurchases.customerRef,
      planCode: s.billPurchases.planCode,
      amountKobo: sql<string>`${s.billPurchases.amountKobo}::text`,
      createdAt: s.billPurchases.createdAt,
      state: sql<
        'pending' | 'delivered' | 'failed'
      >`coalesce(${s.billOutcomes.outcome}, 'pending')`,
      token: s.billOutcomes.token,
      failure: sql<
        string | null
      >`case when ${s.billOutcomes.outcome} = 'failed' then ${s.billOutcomes.reason} end`,
    };
  }

  private async result(tx: FundingDatabase, actor: string, id: string) {
    const [row] = await tx
      .select(this.fields())
      .from(s.billPurchases)
      .leftJoin(s.billOutcomes, eq(s.billOutcomes.billId, s.billPurchases.id))
      .where(
        and(eq(s.billPurchases.id, id), eq(s.billPurchases.accountId, actor)),
      );
    return row!;
  }

  async list(user: string, input: unknown = {}) {
    const query = parse(pageInput, input);
    const limit = query.limit ?? 20;
    return actorTransaction(this.db, user, async (tx, actor) => {
      const rows = await tx
        .select(this.fields())
        .from(s.billPurchases)
        .leftJoin(s.billOutcomes, eq(s.billOutcomes.billId, s.billPurchases.id))
        .where(
          and(
            eq(s.billPurchases.accountId, actor),
            query.after ? lt(s.billPurchases.id, query.after) : undefined,
          ),
        )
        .orderBy(desc(s.billPurchases.createdAt), desc(s.billPurchases.id))
        .limit(limit + 1);
      return {
        items: rows.slice(0, limit),
        nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
      };
    });
  }
}
