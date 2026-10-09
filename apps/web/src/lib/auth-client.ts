import { createAuthClient } from 'better-auth/react';
import {
  inferAdditionalFields,
  twoFactorClient,
} from 'better-auth/client/plugins';
import { apiOrigin } from './api-origin';
export { apiOrigin };
type AuthClientOptions = {
  baseURL: string;
  basePath: string;
  fetchOptions: {
    credentials: 'include';
    timeout: number;
    retry: number;
  };
  plugins: [ReturnType<typeof twoFactorClient>, typeof accountFields];
};
// Fields the API adds to the sign-up form (see the API's auth factory).
const accountFields = inferAdditionalFields({
  user: {
    accountType: { type: 'string', required: false },
    invitedBy: { type: 'string', required: false },
  },
});
type PointRushAuthClient = ReturnType<
  typeof createAuthClient<AuthClientOptions>
>;
let client: PointRushAuthClient | undefined;
// Lazy: missing configuration produces a recoverable UI error, not a broken build.
export function authClient() {
  return (client ??= createAuthClient<AuthClientOptions>({
    plugins: [twoFactorClient({ twoFactorPage: '/two-factor' }), accountFields],
    baseURL: apiOrigin(),
    basePath: '/api/v1/auth',
    fetchOptions: { credentials: 'include', timeout: 15000, retry: 0 },
  }));
}
export class RequestError extends Error {
  // `code` carries Better Auth codes or the API's stable conflict `reason`.
  constructor(
    public readonly status: number,
    public readonly code?: string,
  ) {
    super('Request could not be completed');
  }
}
export function requireSuccess(result: {
  error: { status: number; code?: string } | null;
}) {
  if (result.error)
    throw new RequestError(result.error.status, result.error.code);
}
export function errorMessage(error: unknown): string {
  if (!(error instanceof RequestError))
    return 'We could not confirm the result. Check your connection, then try again. If you were signing up, try signing in first.';
  if (error.status === 429)
    return 'Too many attempts. Wait a minute before trying again. Email requests also have hourly limits.';
  if (error.code === 'EMAIL_NOT_VERIFIED')
    return 'Verify your email before signing in. You can request another verification email below.';
  if (error.status === 401)
    return 'We could not sign you in. Check your email and password, or reset your password.';
  if (error.status === 403)
    return 'This action is unavailable. Check your email verification or sign in again.';
  if (error.status === 409)
    return 'That username is unavailable, or this account is already set up. Try another username or reload your account.';
  if (error.status === 400 || error.status === 422)
    return 'Check your details and try again. If a link has expired, request a new one.';
  return 'The service is temporarily unavailable. Your entries are still here. Try again shortly.';
}
