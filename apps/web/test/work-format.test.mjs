import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backingNaira, workDate } from '../src/lib/work-format.ts';

test('reward display preserves kobo beyond JavaScript safe integer limits', () => {
  assert.equal(backingNaira('0'), '₦0.00');
  assert.equal(backingNaira('105'), '₦1.05');
  assert.equal(backingNaira('900719925474099301'), '₦9,007,199,254,740,993.01');
});

test('task dates use Lagos time regardless of the browser timezone', () => {
  const display = workDate('2026-10-02T23:00:00Z');
  assert.match(display, /3 Oct 2026/);
  assert.match(display, /WAT$/);
});
