import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

// The only events Acticlaim acts on. Anything else is recorded and ignored.
export type VerifiedEvent = {
  eventId: string;
  type: string;
  reference: string | null;
  amountKobo: bigint | null;
  currency: string | null;
};

export class InvalidWebhook extends Error {
  constructor() {
    super('Webhook could not be verified');
  }
}

// A payment provider behind one narrow boundary. The ledger never trusts a
// browser redirect: money moves only on a verified webhook.
export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: {
    intentId: string;
    amountKobo: bigint;
  }): Promise<{ sessionId: string; url: string }>;
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): VerifiedEvent;
  // Must be idempotent on withdrawalId: a repeated call returns the same
  // payout and never sends money twice.
  createPayout(input: {
    withdrawalId: string;
    accountId: string;
    amountKobo: bigint;
  }): Promise<{ payoutId: string }>;
}

// Decimal naira strings ("5000.00") to exact kobo; providers send decimals.
export function decimalToKobo(value: string): bigint | null {
  const match = /^(\d{1,15})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  return BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
}
export function koboToDecimal(kobo: bigint) {
  return `${kobo / 100n}.${(kobo % 100n).toString().padStart(2, '0')}`;
}

const testEvent = z.object({
  id: z.string().min(1).max(200),
  type: z.string().min(1).max(80),
  data: z
    .object({
      reference: z.uuid().nullable().optional(),
      amount: z.string().optional(),
      currency: z.string().max(3).optional(),
    })
    .optional(),
});
const toleranceSeconds = 300;

// Development and test provider. Webhooks are HMAC-SHA256 signed over
// `timestamp.rawBody`, rejected outside a 5-minute window, and compared in
// constant time — the same checks a real provider adapter must make.
// Configuration refuses it in production.
export class TestPaymentProvider implements PaymentProvider {
  readonly name = 'test';
  readonly payouts: { withdrawalId: string; amountKobo: bigint }[] = [];
  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now,
  ) {}

  sign(rawBody: string, timestamp = Math.floor(this.now() / 1000)) {
    const signature = createHmac('sha256', this.secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
    return `t=${timestamp},v1=${signature}`;
  }

  createCheckout(input: { intentId: string; amountKobo: bigint }) {
    return Promise.resolve({
      sessionId: `test_cs_${input.intentId}`,
      url: `https://payments.example.test/checkout/${input.intentId}?amount=${koboToDecimal(input.amountKobo)}`,
    });
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): VerifiedEvent {
    const header = headers['x-test-signature'];
    if (typeof header !== 'string') throw new InvalidWebhook();
    const parts = Object.fromEntries(
      header.split(',').map((part) => part.split('=', 2) as [string, string]),
    );
    const timestamp = Number(parts.t);
    if (
      !Number.isInteger(timestamp) ||
      Math.abs(this.now() / 1000 - timestamp) > toleranceSeconds ||
      !/^[0-9a-f]{64}$/.test(parts.v1 ?? '')
    )
      throw new InvalidWebhook();
    const expected = createHmac('sha256', this.secret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(parts.v1!, 'hex')))
      throw new InvalidWebhook();
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new InvalidWebhook();
    }
    const event = testEvent.safeParse(json);
    if (!event.success) throw new InvalidWebhook();
    const amount = event.data.data?.amount;
    return {
      eventId: event.data.id,
      type: event.data.type,
      reference: event.data.data?.reference ?? null,
      amountKobo: amount === undefined ? null : decimalToKobo(amount),
      currency: event.data.data?.currency ?? null,
    };
  }

  private readonly payoutIds = new Map<string, string>();
  createPayout(input: { withdrawalId: string; amountKobo: bigint }) {
    let id = this.payoutIds.get(input.withdrawalId);
    if (!id) {
      id = `test_po_${randomUUID()}`;
      this.payoutIds.set(input.withdrawalId, id);
      this.payouts.push(input);
    }
    return Promise.resolve({ payoutId: id });
  }
}
