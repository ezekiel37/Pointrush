import test from 'node:test';
import assert from 'node:assert/strict';
import { loginSchema, signupSchema, resetSchema } from '../src/lib/forms.ts';

test('email normalizes outside whitespace while passwords remain exact', () => {
  const password = '  my unchanged passphrase  ';
  assert.deepEqual(
    loginSchema.parse({ email: ' person@example.test ', password }),
    { email: 'person@example.test', password },
  );
});
test('signup rejects short passwords and invisible display names', () => {
  assert.equal(
    signupSchema.safeParse({
      name: '\u200b',
      email: 'person@example.test',
      password: 'a valid long passphrase',
    }).success,
    false,
  );
  assert.equal(
    signupSchema.safeParse({
      name: 'Person',
      email: 'person@example.test',
      password: 'short',
    }).success,
    false,
  );
});
test('password confirmation must match exactly, including spaces', () => {
  const value = {
    password: 'a valid long passphrase',
    confirmation: 'a valid long passphrase ',
  };
  assert.equal(resetSchema.safeParse(value).success, false);
  assert.equal(
    resetSchema.safeParse({ ...value, confirmation: value.password }).success,
    true,
  );
});
