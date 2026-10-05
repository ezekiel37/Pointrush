import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { BachsProvider } from '../src/payments/bachs.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { InvalidWebhook, ProviderError } from '../src/payments/provider.js';
import { campaignFixture } from './helpers/campaign-fixture.js';

const secret = 'whsec_test_bachs_signing_secret';
const now = 1_790_000_000_000;
type Call = {
  url: string;
  init: RequestInit;
  body: Record<string, unknown> | null;
};

// A stand-in for the Bachs API, answering with the documented shapes.
function fakeBachs(
  respond: (call: Call) => { status?: number; json: unknown },
) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const call = {
      url,
      init,
      body: init.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : null,
    };
    calls.push(call);
    const { status = 200, json } = respond(call);
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}
function sign(body: string, timestamp = Math.floor(now / 1000), key = secret) {
  return createHmac('sha256', key).update(`${timestamp}.${body}`).digest('hex');
}
const provider = (fetcher: typeof fetch, apiKey = 'sk_sandbox_abc12345') =>
  new BachsProvider(
    { apiKey, webhookSecret: secret, returnOrigin: 'https://acticlaim.com' },
    fetcher,
    () => now,
  );

test('the key decides sandbox or live, and other keys are refused', async () => {
  const { calls, fetcher } = fakeBachs(() => ({ json: { banks: [] } }));
  await provider(fetcher).listBanks();
  await provider(fetcher, 'sk_live_abc12345').listBanks();
  assert.match(
    calls[0]!.url,
    /^https:\/\/sandbox-api\.bachs\.io\/v1\/reference\/banks\?country=NG$/,
  );
  assert.match(calls[1]!.url, /^https:\/\/api\.bachs\.io\//);
  assert.equal(
    (calls[0]!.init.headers as Record<string, string>).Authorization,
    'Bearer sk_sandbox_abc12345',
  );
  assert.throws(() => provider(fetcher, 'pk_live_nope'));
});

test('checkout charges exact naira with our reference and a retry-safe key', async () => {
  const intent = randomUUID();
  const { calls, fetcher } = fakeBachs(() => ({
    status: 201,
    json: {
      checkout_id: 'chk_123',
      checkout_url: 'https://checkout.bachs.io/c/abc',
      status: 'open',
    },
  }));
  const session = await provider(fetcher).createCheckout({
    intentId: intent,
    amountKobo: 500050n,
    email: 'owner@example.com',
    name: 'Mama Put',
  });
  assert.deepEqual(session, {
    sessionId: 'chk_123',
    url: 'https://checkout.bachs.io/c/abc',
  });
  const call = calls[0]!;
  assert.equal(call.url, 'https://sandbox-api.bachs.io/v1/checkout-sessions');
  assert.equal(
    (call.init.headers as Record<string, string>)['Idempotency-Key'],
    `checkout:${intent}`,
  );
  assert.deepEqual(call.body!.pricing, { currency: 'NGN', amount: '5000.50' });
  assert.equal(call.body!.reference, intent);
  // Bank transfer only: cards can be charged back after payout.
  assert.deepEqual(call.body!.payment_method_types, ['NGN_BANK_TRANSFER']);
  assert.equal(
    call.body!.success_url,
    'https://acticlaim.com/business/funds?paid=1',
  );
  // A non-https checkout URL is never handed to a browser.
  const bad = fakeBachs(() => ({
    json: { checkout_id: 'chk_1', checkout_url: 'http://evil.example' },
  }));
  await assert.rejects(
    provider(bad.fetcher).createCheckout({
      intentId: intent,
      amountKobo: 100000n,
    }),
    ProviderError,
  );
});

test('bank accounts must be approved; the bank name wins over anything typed', async () => {
  const ok = fakeBachs(() => ({
    status: 201,
    json: {
      id: 'pd_7Kq2',
      status: 'approved',
      is_usable: true,
      account_number: '0123456789',
      account_name: 'ADA OKAFOR',
      bank_name: 'Guaranty Trust Bank',
    },
  }));
  assert.deepEqual(
    await provider(ok.fetcher).addDestination({
      bankCode: '058',
      accountNumber: '0123456789',
    }),
    {
      destinationId: 'pd_7Kq2',
      bankName: 'Guaranty Trust Bank',
      accountName: 'ADA OKAFOR',
      last4: '6789',
    },
  );
  assert.deepEqual(ok.calls[0]!.body, {
    currency: 'NGN',
    account_number: '0123456789',
    bank_code: '058',
  });
  const pending = fakeBachs(() => ({
    json: {
      id: 'pd_1',
      status: 'pending_review',
      account_name: 'X',
      bank_name: 'Y',
    },
  }));
  await assert.rejects(
    provider(pending.fetcher).addDestination({
      bankCode: '058',
      accountNumber: '0123456789',
    }),
    (e: ProviderError) => e.permanent,
  );
  const missing = fakeBachs(() => ({
    status: 422,
    json: { error_code: 'VALIDATION_ERROR', detail: 'x' },
  }));
  await assert.rejects(
    provider(missing.fetcher).addDestination({
      bankCode: '058',
      accountNumber: '0123456789',
    }),
    (e: ProviderError) => e.permanent && e.code === 'VALIDATION_ERROR',
  );
});

test('payouts use the withdrawal as key and reference; only refusals are final', async () => {
  const withdrawal = randomUUID();
  const ok = fakeBachs(() => ({
    status: 201,
    json: { id: 'pay_4Xr9', status: 'pending', total_debited: '9050.00' },
  }));
  assert.deepEqual(
    await provider(ok.fetcher).createPayout({
      withdrawalId: withdrawal,
      destinationId: 'pd_7Kq2',
      amountKobo: 900000n,
    }),
    { payoutId: 'pay_4Xr9' },
  );
  assert.deepEqual(ok.calls[0]!.body, {
    destination: 'pd_7Kq2',
    amount: '9000.00',
    reference: withdrawal,
  });
  assert.equal(
    (ok.calls[0]!.init.headers as Record<string, string>)['Idempotency-Key'],
    `withdrawal:${withdrawal}`,
  );
  for (const [status, code, permanent] of [
    [400, 'INSUFFICIENT_BALANCE', false],
    [400, 'ORGANIZATION_IN_DEBT', false],
    [409, 'IDEMPOTENCY_IN_PROGRESS', false],
    [500, undefined, false],
    [400, 'DESTINATION_REJECTED', true],
  ] as const) {
    const failing = fakeBachs(() => ({
      status,
      json: code ? { error_code: code } : {},
    }));
    await assert.rejects(
      provider(failing.fetcher).createPayout({
        withdrawalId: withdrawal,
        destinationId: 'pd_1',
        amountKobo: 900000n,
      }),
      (e: ProviderError) => e.permanent === permanent,
    );
  }
  const down = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  await assert.rejects(
    provider(down).createPayout({
      withdrawalId: withdrawal,
      destinationId: 'pd_1',
      amountKobo: 900000n,
    }),
    (e: ProviderError) => !e.permanent && e.code === 'NETWORK_ERROR',
  );
});

test('webhooks verify V2 signatures, including during secret rotation', () => {
  const p = provider(fakeBachs(() => ({ json: {} })).fetcher);
  const reference = randomUUID();
  const body = JSON.stringify({
    id: 'evt_1',
    type: 'payout.paid',
    created_at: '2026-10-05T12:00:00Z',
    data: {
      withdrawal_id: 'pay_1',
      reference,
      status: 'completed',
      amount: '9000.00',
      currency: 'NGN',
      extra: 1,
    },
    unknown_field: true,
  });
  const ts = Math.floor(now / 1000);
  const event = p.verifyWebhook(Buffer.from(body), {
    'x-bachs-signature-v2': `t=${ts},v1=${sign(body, ts, 'old_secret_value_x')},v1=${sign(body, ts)}`,
  });
  assert.deepEqual(event, {
    eventId: 'evt_1',
    type: 'payout.succeeded',
    reference,
    amountKobo: 900000n,
    currency: 'NGN',
    status: 'completed',
  });
  // Legacy headers still work.
  assert.equal(
    p.verifyWebhook(Buffer.from(body), {
      'x-bachs-timestamp': String(ts),
      'x-bachs-signature': sign(body, ts),
    }).eventId,
    'evt_1',
  );
  for (const headers of [
    {
      'x-bachs-signature-v2': `t=${ts},v1=${sign(body, ts, 'wrong_secret_value')}`,
    },
    { 'x-bachs-signature-v2': `t=${ts - 600},v1=${sign(body, ts - 600)}` },
    { 'x-bachs-signature-v2': `t=${ts}` },
    {},
  ])
    assert.throws(
      () => p.verifyWebhook(Buffer.from(body), headers),
      InvalidWebhook,
    );
  assert.throws(
    () =>
      p.verifyWebhook(Buffer.from(`${body} `), {
        'x-bachs-signature-v2': `t=${ts},v1=${sign(body, ts)}`,
      }),
    InvalidWebhook,
  );
});

const { pg, db, business } = await campaignFixture();
after(() => pg.close());

test('end to end: only an exactly SUCCEEDED naira collection credits the business', async () => {
  const { fetcher } = fakeBachs(() => ({
    status: 201,
    json: {
      checkout_id: `chk_${randomUUID()}`,
      checkout_url: 'https://checkout.bachs.io/c/x',
    },
  }));
  // Webhooks are checked against the real clock here.
  const bachs = new BachsProvider(
    {
      apiKey: 'sk_sandbox_abc12345',
      webhookSecret: secret,
      returnOrigin: 'https://acticlaim.com',
    },
    fetcher,
  );
  const payments = new PaymentsService(db, bachs);
  const merchant = await business('Bachs Foods');
  const deliver = (
    id: string,
    status: string,
    intent: string,
    amount = '5000.00',
  ) => {
    const body = JSON.stringify({
      id,
      type: 'collection.succeeded',
      data: {
        reference: intent,
        status,
        amount,
        currency: 'NGN',
        checkout_id: 'chk_x',
        fee_bearer: 'customer',
      },
    });
    const ts = Math.floor(Date.now() / 1000);
    return payments
      .handleWebhook('bachs', Buffer.from(body), {
        'x-bachs-signature-v2': `t=${ts},v1=${sign(body, ts)}`,
      })
      .then((r) => r.outcome);
  };
  const accepted = randomUUID();
  await payments.createFundingIntent(merchant.user, {
    id: accepted,
    amountKobo: '500000',
  });
  assert.equal(await deliver('evt_a', 'ACCEPTED', accepted), 'mismatch');
  assert.equal(
    await deliver('evt_o', 'OVERPAID', accepted, '6000.00'),
    'mismatch',
  );
  const paid = randomUUID();
  await payments.createFundingIntent(merchant.user, {
    id: paid,
    amountKobo: '500000',
  });
  assert.equal(await deliver('evt_s', 'SUCCEEDED', paid), 'credited');
  assert.equal(await deliver('evt_s', 'SUCCEEDED', paid), 'credited');
  // A non-UUID reference from elsewhere on the account is ignored safely.
  assert.equal(
    await deliver('evt_other', 'SUCCEEDED', 'ORD-20260922-1041'),
    'unknown_reference',
  );
});
