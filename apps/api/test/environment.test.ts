import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readEnvironment } from '../src/config/environment.js';

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
