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
