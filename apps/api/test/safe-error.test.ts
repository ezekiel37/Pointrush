import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeErrorSummary } from '../src/database/safe-error.js';

test('failure summaries show the cause but never connection strings or secrets', () => {
  const inner = Object.assign(
    new Error('self-signed certificate in certificate chain'),
    {
      code: 'SELF_SIGNED_CERT_IN_CHAIN',
    },
  );
  const outer = new Error(
    'connect failed for postgresql://postgres.ref:Sup3rSecret@pooler.example.com:5432/postgres password=Sup3rSecret',
    { cause: inner },
  );
  const summary = safeErrorSummary(outer);
  assert.ok(!summary.includes('Sup3rSecret'));
  assert.match(summary, /\[connection string\]/);
  assert.match(summary, /SELF_SIGNED_CERT_IN_CHAIN: self-signed certificate/);
  assert.equal(safeErrorSummary(undefined), 'unknown error');
  assert.equal(
    safeErrorSummary(
      Object.assign(new Error('x'.repeat(1000)), { code: '28P01' }),
    ).length,
    '28P01: '.length + 300,
  );
});
