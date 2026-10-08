import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { PeriodicRunner } from '../src/workers/inline-workers.js';

test('periodic tasks never overlap, log only activity and keep going after failures', async () => {
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const lines: string[] = [];
  const errors: string[] = [];
  const runner = new PeriodicRunner(
    [
      {
        name: 'demo_batch',
        everyMs: 5,
        run: async () => {
          calls += 1;
          active += 1;
          maxActive = Math.max(maxActive, active);
          await sleep(20);
          active -= 1;
          if (calls === 2)
            throw new Error('password=hunter2 postgres://u:p@host/db');
          return calls === 3 ? { sent: 1 } : undefined;
        },
      },
    ],
    (line) => lines.push(line),
    (line) => errors.push(line),
  );
  runner.start(0);
  await sleep(150);
  await runner.stop();
  const after = calls;
  await sleep(40);
  assert.equal(maxActive, 1);
  assert.ok(calls >= 4);
  assert.equal(calls, after, 'no runs after stop');
  assert.deepEqual(lines, ['{"event":"demo_batch","sent":1}\n']);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /demo_batch_failed/);
  assert.doesNotMatch(errors[0]!, /hunter2|u:p@host/);
});
