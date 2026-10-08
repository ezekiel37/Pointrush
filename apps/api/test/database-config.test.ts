import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { test } from 'node:test';
import {
  poolOptions,
  readDatabaseConfig,
} from '../src/database/database.config.js';

test('production and migration commands require explicit database URLs', () => {
  assert.throws(
    () => readDatabaseConfig({ NODE_ENV: 'production' }),
    /DATABASE_URL/,
  );
  assert.throws(
    () => readDatabaseConfig({}, 'MIGRATION_DATABASE_URL'),
    /MIGRATION_DATABASE_URL/,
  );
  assert.equal(readDatabaseConfig({}), undefined);
});

test('managed database connections validate certificates and bound resource use', () => {
  const config = readDatabaseConfig({
    DATABASE_URL:
      'postgresql://user:secret@db.example.com/pointrush?sslmode=verify-full',
  });
  assert.ok(config);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(config.max, 5);
  assert.equal(new URL(config.connectionString).search, '');
  const options = poolOptions(config);
  assert.equal(options.connectionTimeoutMillis, 3000);
  assert.equal(options.statement_timeout, 5000);
  assert.equal(options.query_timeout, 6000);
});

test('only explicit loopback connections can disable TLS', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(
      readDatabaseConfig({
        DATABASE_URL: `postgres://dev@${host}/test`,
        DATABASE_SSL_MODE: 'disable-local',
      })?.ssl,
      false,
    );
  }
  assert.throws(
    () =>
      readDatabaseConfig({
        DATABASE_URL: 'postgres://dev@remote.test/test',
        DATABASE_SSL_MODE: 'disable-local',
      }),
    /DATABASE_SSL_MODE/,
  );
});

for (const options of [
  'sslmode=disable',
  'sslmode=require',
  'sslcert=/tmp/cert',
  'options=unsafe',
  'sslmode=verify-full&sslmode=disable',
]) {
  test(`rejects connection options that can override policy: ${options}`, () => {
    assert.throws(
      () =>
        readDatabaseConfig({
          DATABASE_URL: `postgres://dev@db.test/app?${options}`,
        }),
      /unsupported/,
    );
  });
}

for (const max of ['0', '21', '-1', '1.5', 'NaN', '']) {
  test(`rejects invalid pool maximum ${JSON.stringify(max)}`, () => {
    assert.throws(
      () =>
        readDatabaseConfig({
          DATABASE_URL: 'postgres://dev@db.test/app',
          DATABASE_POOL_MAX: max,
        }),
      /DATABASE_POOL_MAX/,
    );
  });
}

test('database URL errors do not echo credentials', () => {
  for (const value of [
    'secret-password',
    'https://user:secret-password@host/database',
    'postgres://user:secret-password@host/',
  ]) {
    assert.throws(
      () => readDatabaseConfig({ DATABASE_URL: value }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes('secret-password'));
        return true;
      },
    );
  }
});

test("a provider's own root certificate is added, never used to skip verification", () => {
  const pem =
    '-----BEGIN CERTIFICATE-----\nMIIBexample\n-----END CERTIFICATE-----';
  const url = 'postgresql://user:secret@pooler.example.com/postgres';
  assert.deepEqual(
    readDatabaseConfig({ DATABASE_URL: url, DATABASE_CA_CERT: pem })?.ssl,
    { rejectUnauthorized: true, ca: pem },
  );
  // Pasted on one line with \n escapes, as some dashboards store it.
  assert.deepEqual(
    readDatabaseConfig({
      DATABASE_URL: url,
      DATABASE_CA_CERT: pem.replace(/\n/g, '\\n'),
    })?.ssl,
    { rejectUnauthorized: true, ca: pem },
  );
  assert.throws(
    () => readDatabaseConfig({ DATABASE_URL: url, DATABASE_CA_CERT: 'nope' }),
    /DATABASE_CA_CERT/,
  );
});

test('a certificate pasted as one line (as dashboards store it) is rebuilt and still verified', () => {
  // A real self-signed root certificate, in the format Supabase provides.
  const pem = readFileSync(
    resolve('test/fixtures/test-root-ca.pem'),
    'utf8',
  ).trim();
  const url = 'postgresql://user:secret@pooler.example.com/postgres';
  for (const pasted of [
    pem.replace(/\n/g, ''),
    pem.replace(/\n/g, ' '),
    pem.replace(/\n/g, '\\n'),
    pem,
  ]) {
    const ssl = readDatabaseConfig({
      DATABASE_URL: url,
      DATABASE_CA_CERT: pasted,
    })?.ssl;
    assert.deepEqual(ssl, { rejectUnauthorized: true, ca: pem });
    assert.equal(new X509Certificate(ssl.ca).subject, 'CN=Acticlaim Test Root');
  }
  for (const broken of [`${pem} extra`, 'not a certificate', pem.slice(0, 60)])
    assert.throws(
      () => readDatabaseConfig({ DATABASE_URL: url, DATABASE_CA_CERT: broken }),
      /DATABASE_CA_CERT/,
    );
});
