import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SmsFailed, TermiiSmsProvider } from '../src/phone/sms.js';

const config = {
  apiKey: 'TLtermii-test-key-0123456789',
  senderId: 'Acticlaim',
  baseUrl: 'https://v3.api.termii.com',
  channel: 'dnd' as const,
};

function fake(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = ((url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  return { calls, fetcher };
}

test('a code goes to Termii on the DND route, in international format without +', async () => {
  const { calls, fetcher } = fake(200, {
    code: 'ok',
    message_id: '3017544054459083819856413',
    message: 'Successfully Sent',
    balance: 1047.57,
    user: 'Acticlaim',
  });
  await new TermiiSmsProvider(config, fetcher).send({
    to: '+2348031234567',
    body: 'Your Acticlaim code is 123456',
    reference: 'challenge-1',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://v3.api.termii.com/api/sms/send');
  assert.equal(calls[0]!.init.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
    api_key: config.apiKey,
    to: '2348031234567',
    from: 'Acticlaim',
    sms: 'Your Acticlaim code is 123456',
    type: 'plain',
    channel: 'dnd',
  });
});

test('anything but a confirmed send fails, without echoing the key or the answer', async () => {
  const cases: [number, unknown][] = [
    [401, { message: 'Unauthorized' }],
    [400, { message: 'Insufficient balance' }],
    [200, { message: 'You are not set up on this route' }],
    [200, 'not json'],
  ];
  for (const [status, body] of cases) {
    const { fetcher } = fake(status, body);
    await assert.rejects(
      new TermiiSmsProvider(config, fetcher).send({
        to: '+2348031234567',
        body: 'Your code is 123456',
        reference: 'r',
      }),
      (error: unknown) =>
        error instanceof SmsFailed &&
        !error.message.includes(config.apiKey) &&
        !error.message.includes('Insufficient'),
    );
  }
  // A network failure is a failed send too.
  const down = (() => Promise.reject(new Error('ECONNRESET'))) as typeof fetch;
  await assert.rejects(
    new TermiiSmsProvider(config, down).send({
      to: '+2348031234567',
      body: 'x',
      reference: 'r',
    }),
    SmsFailed,
  );
});
