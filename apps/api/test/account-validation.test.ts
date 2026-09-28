import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createAccountSchema,
  displayNameSchema,
  parseAccountInput,
  usernameSchema,
} from '../src/accounts/account.validation.js';
import {
  AccountError,
  isUsernameConflict,
} from '../src/accounts/account.error.js';

test('usernames canonicalize ASCII case and outer whitespace', () => {
  assert.equal(usernameSchema.parse(' Eze_123 '), 'eze_123');
  assert.equal(usernameSchema.parse('abc'), 'abc');
  assert.equal(usernameSchema.parse('A'.repeat(20)), 'a'.repeat(20));
});

for (const value of [
  'ab',
  'a'.repeat(21),
  '1abc',
  '_abc',
  'abc_',
  'ab__cd',
  'ab-c',
  'ab.c',
  '\u212Aelvin',
  '\u00e9ze',
  'abc\nxyz',
  'a b',
  '',
  null,
  123,
]) {
  test(`rejects invalid username ${JSON.stringify(value)}`, () => {
    assert.equal(usernameSchema.safeParse(value).success, false);
  });
}

test('display names preserve Unicode, apostrophes, hyphens and internal spaces', () => {
  for (const name of [
    "Ojo O'Neil",
    'Anne-Marie',
    '\u00c9z\u00e9',
    '\u4f60\u597d',
    '\u0645\u062d\u0645\u062f',
    'A  B',
    '\ud83d\ude00',
  ]) {
    assert.equal(displayNameSchema.parse(` ${name} `), name);
  }
});

test('display-name limits count Unicode code points, not UTF-16 units', () => {
  assert.equal(
    displayNameSchema.parse('\ud83d\ude00'.repeat(80)),
    '\ud83d\ude00'.repeat(80),
  );
  assert.equal(
    displayNameSchema.safeParse('\ud83d\ude00'.repeat(81)).success,
    false,
  );
});

for (const value of [
  '',
  '   ',
  '\u200b\u200d',
  '\u0301',
  'A\u0000B',
  'A\nB',
  '\tName',
  '\u202eName',
  '\ud800',
  'x'.repeat(81),
]) {
  test(`rejects invalid display name ${JSON.stringify(value)}`, () => {
    assert.equal(displayNameSchema.safeParse(value).success, false);
  });
}

test('input rejects privilege fields, timestamps and hidden identifiers', () => {
  for (const key of [
    'id',
    'accessState',
    'role',
    'usernameChangedAt',
    'verified',
  ]) {
    assert.throws(
      () =>
        parseAccountInput(createAccountSchema, {
          username: 'valid_name',
          displayName: 'Eze',
          [key]: true,
        }),
      AccountError,
    );
  }
});

test('validation errors have stable safe codes and never echo invalid input', () => {
  assert.throws(
    () =>
      parseAccountInput(createAccountSchema, {
        username: 'secret.invalid',
        displayName: 'Eze',
      }),
    (error: unknown) => {
      assert.ok(error instanceof AccountError);
      assert.equal(error.code, 'INVALID_ACCOUNT_INPUT');
      assert.equal(error.field, 'username');
      assert.ok(!error.message.includes('secret.invalid'));
      return true;
    },
  );
});

test('only the known username uniqueness constraint maps to a name conflict', () => {
  const driver = Object.assign(new Error('private SQL details'), {
    code: '23505',
    constraint: 'usernames_pkey',
  });
  assert.equal(
    isUsernameConflict(new Error('wrapper', { cause: driver })),
    true,
  );
  assert.equal(
    isUsernameConflict(
      Object.assign(new Error('other'), {
        code: '23505',
        constraint: 'another_constraint',
      }),
    ),
    false,
  );
  assert.equal(isUsernameConflict(new Error('network error')), false);
  const circular = new Error('circular');
  circular.cause = circular;
  assert.equal(isUsernameConflict(circular), false);
});
