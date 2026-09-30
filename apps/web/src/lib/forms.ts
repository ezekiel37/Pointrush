import { z } from 'zod';
import {
  displayNameSchema,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from '@pointrush/contracts';
export const emailSchema = z
  .string()
  .trim()
  .pipe(z.email('Enter a valid email address.').max(254));
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(
    PASSWORD_MAX_LENGTH,
    `Use no more than ${PASSWORD_MAX_LENGTH} characters.`,
  );
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.').max(PASSWORD_MAX_LENGTH),
});
export const signupSchema = z.object({
  name: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export const emailRequestSchema = z.object({ email: emailSchema });
export const resetSchema = z
  .object({ password: passwordSchema, confirmation: z.string() })
  .refine((data) => data.password === data.confirmation, {
    message: 'The passwords must match.',
    path: ['confirmation'],
  });
