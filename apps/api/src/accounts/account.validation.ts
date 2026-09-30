import type { z } from 'zod';
import { AccountError } from './account.error.js';

export {
  usernameSchema,
  displayNameSchema,
  accountIdSchema,
  createAccountSchema,
  renameAccountSchema,
} from '@pointrush/contracts';

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
