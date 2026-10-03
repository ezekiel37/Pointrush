import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimAction } from '../src/lib/claim.ts';
const now = Date.parse('2026-10-03T12:00:00Z');
const base = () => ({
  participant: true,
  task: {
    endsAt: new Date(now + 1000).toISOString(),
    workTerms: { correctionHours: 24, appealHours: 48 },
  },
  proofs: [],
});
const proof = (decision, receipt = null, revision = 1) => ({
  proof: { id: 'proof', revision },
  decision: { decision },
  receipt,
  appeal: null,
});
test('first proof closes at the exact deadline and sponsors get no participant actions', () => {
  const data = base();
  assert.equal(claimAction(data, now).kind, 'proof');
  assert.equal(claimAction(data, now + 1000).kind, 'closed');
  data.participant = false;
  assert.equal(claimAction(data, now).kind, 'none');
});
test('unseen decisions require explicit receipt even long after task expiry', () => {
  for (const decision of ['rejected', 'changes_required']) {
    const data = base();
    data.proofs = [proof(decision)];
    assert.equal(claimAction(data, now + 1000000000).kind, 'acknowledge');
  }
});
test('correction is allowed after task expiry until the receipt deadline exclusively', () => {
  const data = base();
  data.task.endsAt = new Date(now - 1000).toISOString();
  data.proofs = [
    proof('changes_required', { createdAt: new Date(now).toISOString() }),
  ];
  assert.equal(claimAction(data, now).revision, 2);
  assert.equal(claimAction(data, now + 86400000).kind, 'closed');
});
test('appeal window is independent of correction window and cannot repeat', () => {
  const data = base();
  data.proofs = [proof('rejected', { createdAt: new Date(now).toISOString() })];
  assert.equal(claimAction(data, now + 86400000).kind, 'appeal');
  assert.equal(claimAction(data, now + 172800000).kind, 'closed');
  data.proofs[0].appeal = { id: 'appeal' };
  assert.equal(claimAction(data, now).kind, 'none');
});
test('latest revision wins regardless of response ordering; approved work cannot resubmit', () => {
  const data = base();
  data.proofs = [
    proof('approved', null, 2),
    proof('changes_required', null, 1),
  ];
  assert.equal(claimAction(data, now).kind, 'none');
});
