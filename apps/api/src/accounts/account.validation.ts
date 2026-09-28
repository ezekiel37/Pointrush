import { z } from 'zod';
import { AccountError } from './account.error.js';

// Check ASCII before lowercasing; Unicode case folding must not claim an ASCII name.
export const usernameSchema = z
  .string()
  .max(64)
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9_]{1,18}[A-Za-z0-9]$/)
  .refine((value) => !value.includes('__'))
  .transform((value) => value.toLowerCase());

export const displayNameSchema = z
  .string()
  .max(320)
  .refine((value) => !/[\p{Cc}\p{Cs}\u202a-\u202e\u2066-\u2069]/u.test(value))
  .trim()
  .refine((value) => [...value].length >= 1 && [...value].length <= 80)
  .refine(
    (value) =>
      value.replace(
        /[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{M}]/gu,
        '',
      ).length > 0,
  );

export const createAccountSchema = z.strictObject({
  username: usernameSchema,
  displayName: displayNameSchema,
});
export const renameAccountSchema = z.strictObject({ username: usernameSchema });
export const accountIdSchema = z.uuid();

export function parseAccountInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const path = result.error.issues[0]?.path[0];
  const field =
    path === 'username' || path === 'displayName' ? path : undefined;
  const message =
    field === 'username'
      ? 'Use 3-20 letters, digits or underscores; start with a letter, end with a letter or digit, and avoid consecutive underscores.'
      : field === 'displayName'
        ? 'Use a visible display name of 1-80 characters without control characters.'
        : 'Account input contains invalid or unsupported fields.';
  throw new AccountError('INVALID_ACCOUNT_INPUT', message, field);
}
