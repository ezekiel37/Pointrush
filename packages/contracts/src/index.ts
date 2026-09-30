import { z } from 'zod';

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

export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 128;
