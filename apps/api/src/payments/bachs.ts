import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  decimalToKobo,
  InvalidWebhook,
  koboToDecimal,
  ProviderError,
} from './provider.js';
import type {
  Bank,
  Destination,
  PaymentProvider,
  VerifiedEvent,
} from './provider.js';

// Bachs (https://docs.bachs.io). Sandbox and live are the same API on two
// hosts; the key prefix decides which. Money is a decimal string, never a
// number. Every POST that moves money carries an Idempotency-Key.
export type BachsConfig = {
  apiKey: string;
  webhookSecret: string;
  // The web app origin customers return to after checkout.
  returnOrigin: string;
};

const toleranceSeconds = 300;
// Payout errors that will never succeed on retry. Everything else (our
// balance short, provider unavailable, rate limited) is retried later with the
// same key, and the money stays held meanwhile.
const permanentPayoutErrors = new Set([
  'DESTINATION_REJECTED',
  'DESTINATION_NOT_FOUND',
  'NOT_FOUND',
]);
const permanentDestinationErrors = new Set([
  'ACCOUNT_NOT_FOUND',
  'ACCOUNT_RESOLUTION_FAILED',
  'DESTINATION_REJECTED',
  'INVALID_BANK_CODE',
  'NOT_FOUND',
  'VALIDATION_ERROR',
]);

const envelope = z.object({
  id: z.string().min(1).max(200),
  type: z.string().min(1).max(80),
  data: z
    .object({
      reference: z.string().max(128).nullable().optional(),
      amount: z.string().nullable().optional(),
      currency: z.string().max(3).nullable().optional(),
      status: z.string().max(40).nullable().optional(),
    })
    .loose()
    .optional(),
});
const checkoutResponse = z.object({
  checkout_id: z.string().min(1).max(200),
  checkout_url: z.url({ protocol: /^https$/ }),
});
const destinationResponse = z.object({
  id: z.string().min(1).max(120),
  status: z.string(),
  is_usable: z.boolean().optional(),
  account_number: z.string().optional(),
  account_name: z.string().min(1),
  bank_name: z.string().min(1),
});
const payoutResponse = z.object({ id: z.string().min(1).max(200) });
const banksResponse = z.object({
  banks: z.array(z.object({ name: z.string(), code: z.string() })),
});
const errorBody = z.object({ error_code: z.string() }).partial();

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
) {
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
}

export class BachsProvider implements PaymentProvider {
  readonly name = 'bachs';
  private readonly baseUrl: string;

  constructor(
    private readonly config: BachsConfig,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    if (config.apiKey.startsWith('sk_live_'))
      this.baseUrl = 'https://api.bachs.io';
    else if (config.apiKey.startsWith('sk_sandbox_'))
      this.baseUrl = 'https://sandbox-api.bachs.io';
    else throw new Error('Bachs API key must be a sk_live_ or sk_sandbox_ key');
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      // A network error is not proof nothing happened; callers retry with
      // the same idempotency key.
      throw new ProviderError('NETWORK_ERROR', false);
    }
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = errorBody.safeParse(json);
      throw new ProviderError(
        (parsed.success && parsed.data.error_code) || `HTTP_${response.status}`,
        false,
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ProviderError('UNEXPECTED_RESPONSE', false);
    return parsed.data;
  }

  async createCheckout(input: {
    intentId: string;
    amountKobo: bigint;
    email?: string;
    name?: string;
  }) {
    const returnTo = `${this.config.returnOrigin}/business/funds`;
    const session = await this.request(
      'POST',
      '/v1/checkout-sessions',
      checkoutResponse,
      {
        pricing: { currency: 'NGN', amount: koboToDecimal(input.amountKobo) },
        // Our intent ID comes back on collection.succeeded as data.reference.
        reference: input.intentId,
        // Bank transfer only: card payments can be charged back weeks later,
        // after the money has been paid out (see SECURITY_REVIEW.md, C1).
        payment_method_types: ['NGN_BANK_TRANSFER'],
        success_url: `${returnTo}?paid=1`,
        cancel_url: returnTo,
        expires_in_minutes: 60,
        metadata: { intent_id: input.intentId },
        ...(input.email
          ? { customer: { email: input.email, name: input.name } }
          : {}),
      },
      `checkout:${input.intentId}`,
    );
    return { sessionId: session.checkout_id, url: session.checkout_url };
  }

  async listBanks(): Promise<Bank[]> {
    const result = await this.request(
      'GET',
      '/v1/reference/banks?country=NG',
      banksResponse,
    );
    return result.banks
      .filter((b) => b.code && b.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async addDestination(input: {
    bankCode: string;
    accountNumber: string;
  }): Promise<Destination> {
    let created: z.infer<typeof destinationResponse>;
    try {
      created = await this.request(
        'POST',
        '/v1/payouts/destinations',
        destinationResponse,
        {
          currency: 'NGN',
          account_number: input.accountNumber,
          bank_code: input.bankCode,
        },
      );
    } catch (error) {
      if (
        error instanceof ProviderError &&
        permanentDestinationErrors.has(error.code)
      )
        throw new ProviderError(error.code, true);
      throw error;
    }
    // Only an account the bank resolved is payable.
    if (created.status !== 'approved' || created.is_usable === false)
      throw new ProviderError('DESTINATION_NOT_APPROVED', true);
    return {
      destinationId: created.id,
      bankName: created.bank_name,
      // The bank's own name for the account, never what the user typed.
      accountName: created.account_name,
      last4: input.accountNumber.slice(-4),
    };
  }

  async createPayout(input: {
    withdrawalId: string;
    destinationId: string;
    amountKobo: bigint;
  }) {
    try {
      const payout = await this.request(
        'POST',
        '/v1/payouts',
        payoutResponse,
        {
          destination: input.destinationId,
          // What the person receives; Bachs adds its fee on top.
          amount: koboToDecimal(input.amountKobo),
          // Comes back on payout.paid / payout.failed as data.reference.
          reference: input.withdrawalId,
        },
        `withdrawal:${input.withdrawalId}`,
      );
      return { payoutId: payout.id };
    } catch (error) {
      if (
        error instanceof ProviderError &&
        permanentPayoutErrors.has(error.code)
      )
        throw new ProviderError(error.code, true);
      throw error;
    }
  }

  // X-Bachs-Signature-V2: t=<ts>,v1=<hex>[,v1=<hex>] over "<ts>.<raw body>".
  // Several v1 values appear while a secret is being rotated; any may match.
  // Falls back to the X-Bachs-Timestamp / X-Bachs-Signature pair.
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): VerifiedEvent {
    let timestamp: number;
    let signatures: string[];
    const v2 = header(headers, 'x-bachs-signature-v2');
    if (v2) {
      const parts = v2.split(',').map((p) => {
        const at = p.indexOf('=');
        return [p.slice(0, at).trim(), p.slice(at + 1).trim()] as const;
      });
      timestamp = Number(parts.find(([k]) => k === 't')?.[1]);
      signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
    } else {
      timestamp = Number(header(headers, 'x-bachs-timestamp'));
      const legacy = header(headers, 'x-bachs-signature');
      signatures = legacy ? [legacy] : [];
    }
    if (
      !Number.isInteger(timestamp) ||
      Math.abs(this.now() / 1000 - timestamp) > toleranceSeconds
    )
      throw new InvalidWebhook();
    const expected = createHmac('sha256', this.config.webhookSecret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest();
    const valid = signatures.some(
      (s) =>
        /^[0-9a-f]{64}$/i.test(s) &&
        timingSafeEqual(expected, Buffer.from(s, 'hex')),
    );
    if (!valid) throw new InvalidWebhook();

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new InvalidWebhook();
    }
    // Lenient: Bachs may add fields at any time.
    const event = envelope.safeParse(json);
    if (!event.success) throw new InvalidWebhook();
    const data = event.data.data ?? {};
    const reference =
      data.reference && uuid.test(data.reference) ? data.reference : null;
    const type =
      event.data.type === 'payout.paid' ? 'payout.succeeded' : event.data.type;
    return {
      eventId: event.data.id,
      type,
      reference,
      amountKobo: data.amount ? decimalToKobo(data.amount) : null,
      currency: data.currency ?? null,
      status: data.status ?? null,
    };
  }
}
