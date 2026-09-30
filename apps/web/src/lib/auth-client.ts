import { createAuthClient } from 'better-auth/react';
export function apiOrigin(): string {
  const value = process.env.NEXT_PUBLIC_API_ORIGIN;
  if (!value) throw new Error('API configuration unavailable');
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.origin !== value ||
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
  )
    throw new Error('Invalid API configuration');
  return value;
}
let client: ReturnType<typeof createAuthClient> | undefined;
// Lazy: missing configuration produces a recoverable UI error, not a broken build.
export function authClient() {
  return (client ??= createAuthClient({
    baseURL: apiOrigin(),
    basePath: '/api/v1/auth',
    fetchOptions: { credentials: 'include', timeout: 15000, retry: 0 },
  }));
}
export class RequestError extends Error {
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
