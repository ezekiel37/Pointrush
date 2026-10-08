import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeNext, withNext } from '../src/lib/next-path.ts';

test('accepts same-site paths', () => {
  assert.equal(safeNext('/claim'), '/claim');
  assert.equal(safeNext('/offers?tab=near'), '/offers?tab=near');
});

test('rejects paths that leave the site or carry markup', () => {
  for (const value of [
    null,
    '',
    'claim',
    '//evil.example',
    '/\\evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '/claim"><script>',
    '/' + 'a'.repeat(200),
  ])
    assert.equal(safeNext(value), null, String(value));
});

test('carries the return path', () => {
  assert.equal(withNext('/signup', '/claim'), '/signup?next=%2Fclaim');
  assert.equal(withNext('/signup', null), '/signup');
});
