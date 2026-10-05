import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readEnvironment } from '../src/config/environment.js';
import { readEmailWorkerEnvironment } from '../src/config/email-worker.environment.js';

const apiConfig = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://runtime:example@db.example.test/pointrush',
  CORS_ORIGINS: 'https://app.example.test',
  AUTH_SECRET: 'test-only-secret-with-at-least-32-characters',
  AUTH_BASE_URL: 'https://api.example.test',
  EMAIL_FROM: 'accounts@example.test',
  AUTH_EMAIL_ENCRYPTION_KEY: 'ab'.repeat(32),
};

test('production API queues mail without delivery credentials and preserves the secret', () => {
  const secret = ` ${apiConfig.AUTH_SECRET} `;
  const config = readEnvironment({ ...apiConfig, AUTH_SECRET: secret });
  assert.equal(config.auth?.secret, secret);
  assert.equal(config.auth?.emailFrom, apiConfig.EMAIL_FROM);
  assert.ok(!('resendApiKey' in config.auth!));
  assert.deepEqual(
    readEnvironment({ ...apiConfig, RESEND_API_KEY: 'ignored' }),
    readEnvironment(apiConfig),
  );
});

test('local auth accepts loopback HTTP only outside production', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const local = {
      ...apiConfig,
      NODE_ENV: 'development',
      AUTH_BASE_URL: `http://${host}:8080`,
      CORS_ORIGINS: `http://${host}:3000`,
    };
    assert.equal(readEnvironment(local).auth?.baseURL, local.AUTH_BASE_URL);
    assert.throws(
      () => readEnvironment({ ...local, NODE_ENV: 'production' }),
      /CORS_ORIGINS/,
    );
    assert.throws(
      () =>
        readEnvironment({ ...apiConfig, AUTH_BASE_URL: local.AUTH_BASE_URL }),
      /AUTH_BASE_URL/,
    );
    assert.throws(
      () =>
        readEnvironment({
          ...apiConfig,
          AUTH_TRUSTED_ORIGINS: local.CORS_ORIGINS,
        }),
      /AUTH_TRUSTED_ORIGINS/,
    );
  }
});

test('auth configuration rejects incomplete settings and unsafe explicit origins', () => {
  for (const field of [
    'AUTH_SECRET',
    'AUTH_BASE_URL',
    'EMAIL_FROM',
    'AUTH_EMAIL_ENCRYPTION_KEY',
  ]) {
    assert.throws(
      () => readEnvironment({ ...apiConfig, [field]: undefined }),
      /Authentication configuration/,
    );
  }
  for (const origin of [
    'http://remote.test',
    'https://*.example.test',
    'https://example.test/path',
    'https://user:secret@example.test',
  ]) {
    for (const field of ['AUTH_BASE_URL', 'AUTH_TRUSTED_ORIGINS']) {
      assert.throws(
        () =>
          readEnvironment({
            ...apiConfig,
            NODE_ENV: 'development',
            [field]: origin,
          }),
        new RegExp(field),
      );
    }
  }
});

test('worker requires only delivery and database settings, independently from API settings', () => {
  const input = {
    NODE_ENV: 'production',
    DATABASE_URL: apiConfig.DATABASE_URL,
    RESEND_API_KEY: 're_test_only',
    AUTH_EMAIL_ENCRYPTION_KEY: apiConfig.AUTH_EMAIL_ENCRYPTION_KEY,
  };
  const config = readEmailWorkerEnvironment(input);
  assert.equal(config.maxDurationMs, 60000);
  assert.equal(config.resendApiKey, input.RESEND_API_KEY);
  assert.deepEqual(
    readEmailWorkerEnvironment({
      ...input,
      PORT: 'invalid',
      AUTH_BASE_URL: 'invalid',
      EMAIL_FROM: 'invalid',
    }),
    config,
  );
  for (const field of [
    'DATABASE_URL',
    'RESEND_API_KEY',
    'AUTH_EMAIL_ENCRYPTION_KEY',
  ]) {
    assert.throws(
      () => readEmailWorkerEnvironment({ ...input, [field]: undefined }),
      new RegExp(field),
    );
  }
  for (const duration of ['0', '999', '300001', '1.5', 'Infinity', '']) {
    assert.throws(
      () =>
        readEmailWorkerEnvironment({
          ...input,
          EMAIL_WORKER_MAX_DURATION_MS: duration,
        }),
      /EMAIL_WORKER_MAX_DURATION_MS/,
    );
  }
});

test('development defaults are explicit and deny cross-origin access', () => {
  assert.deepEqual(readEnvironment({}), {
    nodeEnv: 'development',
    port: 8080,
    corsOrigins: [],
  });
});

test('accepts Cloud Run port and deduplicates explicit origins', () => {
  assert.deepEqual(
    readEnvironment({
      NODE_ENV: 'test',
      PORT: '9090',
      CORS_ORIGINS: 'https://example.com, https://example.com',
    }),
    { nodeEnv: 'test', port: 9090, corsOrigins: ['https://example.com'] },
  );
});

for (const port of ['0', '-1', '65536', '8e3', '8080abc', '', '1.5']) {
  test(`rejects invalid port ${JSON.stringify(port)}`, () => {
    assert.throws(() => readEnvironment({ PORT: port }), /PORT/);
  });
}

for (const origin of [
  '',
  '*',
  'null',
  'http://example.com',
  'https://example.com/path',
  'https://user:password@example.com',
  'https://example.com/',
]) {
  test(`rejects unsafe production origin ${JSON.stringify(origin)}`, () => {
    assert.throws(
      () => readEnvironment({ NODE_ENV: 'production', CORS_ORIGINS: origin }),
      /CORS_ORIGINS/,
    );
  });
}

test('configuration errors never echo input values', () => {
  assert.throws(
    () => readEnvironment({ NODE_ENV: 'secret-value' }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes('secret-value'));
      return true;
    },
  );
});

test('email budgets reject invalid or excessive configured limits', () => {
  for (const value of ['0', '-1', '10001', '1.5', 'Infinity', '']) {
    assert.throws(
      () => readEnvironment({ AUTH_EMAIL_DAILY_LIMIT: value }),
      /AUTH_EMAIL_DAILY_LIMIT/,
    );
  }
});

test('queue encryption key rejects malformed values without echoing them', () => {
  for (const value of ['short-secret', 'x'.repeat(64), 'a'.repeat(63)]) {
    assert.throws(
      () => readEnvironment({ AUTH_EMAIL_ENCRYPTION_KEY: value }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /AUTH_EMAIL_ENCRYPTION_KEY/);
        assert.ok(!error.message.includes(value));
        return true;
      },
    );
  }
});

test('payments need a provider and secret together and never the test provider in production', () => {
  const secret = 'payments-webhook-secret-of-32-chars!';
  const local = { ...apiConfig, NODE_ENV: 'development' };
  assert.equal(readEnvironment(local).payments, undefined);
  assert.deepEqual(
    readEnvironment({
      ...local,
      PAYMENTS_PROVIDER: 'test',
      PAYMENTS_WEBHOOK_SECRET: secret,
    }).payments,
    { provider: 'test', webhookSecret: secret },
  );
  assert.throws(
    () => readEnvironment({ ...local, PAYMENTS_PROVIDER: 'test' }),
    /must be complete/,
  );
  assert.throws(
    () => readEnvironment({ ...local, PAYMENTS_WEBHOOK_SECRET: secret }),
    /must be complete/,
  );
  assert.throws(() =>
    readEnvironment({
      ...local,
      PAYMENTS_PROVIDER: 'test',
      PAYMENTS_WEBHOOK_SECRET: 'short',
    }),
  );
  assert.throws(
    () =>
      readEnvironment({
        ...apiConfig,
        PAYMENTS_PROVIDER: 'test',
        PAYMENTS_WEBHOOK_SECRET: secret,
      }),
    /cannot run in production/,
  );
});

test('SMS is restricted to configured countries and never the test provider in production', () => {
  const local = { ...apiConfig, NODE_ENV: 'development' };
  assert.equal(readEnvironment(local).sms, undefined);
  assert.deepEqual(readEnvironment({ ...local, SMS_PROVIDER: 'test' }).sms, {
    provider: 'test',
    allowedPrefixes: ['+234'],
    dailyLimit: 500,
  });
  assert.deepEqual(
    readEnvironment({
      ...local,
      SMS_PROVIDER: 'test',
      SMS_ALLOWED_PREFIXES: '+234, +233',
      SMS_DAILY_LIMIT: '50',
    }).sms,
    { provider: 'test', allowedPrefixes: ['+234', '+233'], dailyLimit: 50 },
  );
  assert.throws(() =>
    readEnvironment({
      ...local,
      SMS_PROVIDER: 'test',
      SMS_ALLOWED_PREFIXES: '234',
    }),
  );
  assert.throws(
    () => readEnvironment({ ...apiConfig, SMS_PROVIDER: 'test' }),
    /cannot run in production/,
  );
});

test('Bachs needs a key, secret and return origin, with live keys only in production', () => {
  const sandbox = {
    ...apiConfig,
    NODE_ENV: 'development',
    PAYMENTS_PROVIDER: 'bachs',
    PAYMENTS_WEBHOOK_SECRET: 'whsec_0123456789abcdef',
    BACHS_API_KEY: 'sk_sandbox_abcdef123456',
    PAYMENTS_RETURN_ORIGIN: 'https://app.example.test',
  };
  assert.deepEqual(readEnvironment(sandbox).payments, {
    provider: 'bachs',
    webhookSecret: 'whsec_0123456789abcdef',
    apiKey: 'sk_sandbox_abcdef123456',
    returnOrigin: 'https://app.example.test',
  });
  assert.throws(
    () => readEnvironment({ ...sandbox, BACHS_API_KEY: undefined }),
    /must be complete/,
  );
  assert.throws(
    () => readEnvironment({ ...sandbox, PAYMENTS_RETURN_ORIGIN: undefined }),
    /must be complete/,
  );
  assert.throws(
    () =>
      readEnvironment({ ...sandbox, BACHS_API_KEY: 'sk_live_abcdef123456' }),
    /sk_live_/,
  );
  assert.throws(
    () => readEnvironment({ ...sandbox, NODE_ENV: 'production' }),
    /sk_live_/,
  );
  assert.equal(
    readEnvironment({
      ...sandbox,
      NODE_ENV: 'production',
      BACHS_API_KEY: 'sk_live_abcdef123456',
    }).payments?.provider,
    'bachs',
  );
  assert.throws(() =>
    readEnvironment({ ...sandbox, BACHS_API_KEY: 'not-a-key' }),
  );
  assert.throws(
    () =>
      readEnvironment({
        ...apiConfig,
        NODE_ENV: 'development',
        BACHS_API_KEY: 'sk_sandbox_abcdef123456',
      }),
    /PAYMENTS_PROVIDER is not bachs/,
  );
});
