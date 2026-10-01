import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  EmailBatchRunner,
  EmailRunnerController,
} from '../src/auth/email-http.js';
import { configureHttp } from '../src/http/configure-http.js';
import {
  createResendPayloadSender,
  EmailDeliveryError,
} from '../src/auth/auth.email.js';

const secret = 'a'.repeat(64);

test('HTTP trigger requires machine credentials and rejects inputs and wrong methods', async () => {
  let calls = 0;
  const runner = new EmailBatchRunner(
    {
      runOne: async () => {
        calls++;
        return 'idle';
      },
      prune: async () => {},
    },
    { secret, maxDurationMs: 1000 },
  );
  @Module({
    controllers: [EmailRunnerController],
    providers: [{ provide: EmailBatchRunner, useValue: runner }],
  })
  class TestModule {}
  const app = await NestFactory.create<NestExpressApplication>(TestModule, {
    logger: false,
    bodyParser: false,
  });
  configureHttp(app, { nodeEnv: 'test', port: 8080, corsOrigins: [] });
  await app.listen(0, '127.0.0.1');
  try {
    const url = `${await app.getUrl()}/api/v1/internal/auth-email/run`;
    const invalidHeaders: Record<string, string>[] = [
      {},
      { cookie: 'session=anything' },
      { 'X-PointRush-Worker-Key': 'wrong' },
    ];
    for (const headers of invalidHeaders) {
      assert.equal((await fetch(url, { method: 'POST', headers })).status, 401);
    }
    const headers = { 'X-PointRush-Worker-Key': secret };
    assert.equal((await fetch(url, { headers })).status, 404);
    assert.equal(
      (await fetch(`${url}?limit=1000`, { method: 'POST', headers })).status,
      400,
    );
    assert.equal(
      (await fetch(url, { method: 'POST', headers, body: 'payload' })).status,
      400,
    );
    assert.equal(calls, 0);
    const response = await fetch(url, { method: 'POST', headers });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      outcomes: { idle: 1 },
      interrupted: false,
    });
    assert.equal(calls, 1);
  } finally {
    await app.close();
  }
});

test('deadline cancels delivery, rejects overlap and awaits settlement before releasing lock', async () => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let settle!: () => void;
  const settlement = new Promise<void>((resolve) => {
    settle = resolve;
  });
  let aborted!: () => void;
  const stopped = new Promise<void>((resolve) => {
    aborted = resolve;
  });
  let calls = 0;
  const runner = new EmailBatchRunner(
    {
      runOne: async (signal) => {
        calls++;
        entered();
        await new Promise<void>((resolve) =>
          signal!.addEventListener(
            'abort',
            () => {
              aborted();
              resolve();
            },
            { once: true },
          ),
        );
        await settlement;
        return 'retry';
      },
      prune: async () => {
        assert.fail('Do not prune after deadline');
      },
    },
    { secret, maxDurationMs: 30 },
  );
  const request = runner.run(new AbortController().signal);
  await started;
  await assert.rejects(runner.run(new AbortController().signal), /busy/);
  await stopped;
  await assert.rejects(runner.run(new AbortController().signal), /busy/);
  settle();
  assert.deepEqual(await request, {
    outcomes: { retry: 1 },
    interrupted: true,
  });
  assert.equal(calls, 1);
});

test('batch caps work at 25 and shutdown prevents future claims', async () => {
  let calls = 0;
  let prunes = 0;
  const runner = new EmailBatchRunner(
    {
      runOne: async () => {
        calls++;
        return 'accepted';
      },
      prune: async () => {
        prunes++;
      },
    },
    { secret, maxDurationMs: 1000 },
  );
  await runner.run(new AbortController().signal);
  assert.equal(calls, 25);
  assert.equal(prunes, 1);
  runner.onApplicationShutdown();
  await assert.rejects(runner.run(new AbortController().signal), /busy/);
});

test('Resend cancellation prevents inline retry and preserves idempotency key', async () => {
  const controller = new AbortController();
  let calls = 0;
  const send = createResendPayloadSender('test-key', async (_url, options) => {
    calls++;
    assert.equal(
      (options!.headers as Record<string, string>)['Idempotency-Key'],
      'auth-email/job',
    );
    controller.abort();
    throw new Error('ambiguous provider acceptance');
  });
  await assert.rejects(
    send(
      {
        from: 'a@example.com',
        to: 'b@example.com',
        subject: 'test',
        text: 'test',
      },
      'auth-email/job',
      controller.signal,
    ),
    EmailDeliveryError,
  );
  assert.equal(calls, 1);
});
