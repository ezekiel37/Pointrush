import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { z } from 'zod';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from '../database/schema.js';
import { authAdapterSchema } from './auth.schema.js';
import type { SendAuthEmail } from './auth.email.js';

export interface AuthConfig {
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
}

function validateConfig(config: AuthConfig): void {
  if (config.secret.trim().length < 32)
    throw new Error('Auth secret must contain at least 32 characters');
  for (const origin of [config.baseURL, ...config.trustedOrigins]) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error('Auth requires exact trusted origins');
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      origin.includes('*') ||
      url.origin !== origin ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    ) {
      throw new Error(
        'Auth requires HTTPS origins (HTTP allowed only on loopback)',
      );
    }
  }
}

// Internal foundation only. Mounting requires the security boundary documented in AUTH.md.
export function createAuth(
  db: PgDatabase<PgQueryResultHKT, typeof schema>,
  config: AuthConfig,
  sendEmail: SendAuthEmail,
  reserveEmail?: (recipient: string) => Promise<boolean>,
) {
  validateConfig(config);
  return betterAuth({
    appName: 'PointRush',
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: '/api/v1/auth',
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: authAdapterSchema,
      transaction: true,
    }),
    logger: { disabled: true },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          !reserveEmail ||
          ![
            '/sign-up/email',
            '/send-verification-email',
            '/request-password-reset',
          ].includes(ctx.path)
        )
          return;
        const email = z.email().safeParse(ctx.body?.email);
        if (!email.success) return; // Endpoint validation rejects invalid input.
        let allowed: boolean;
        try {
          allowed = await reserveEmail(email.data);
        } catch {
          throw new APIError('SERVICE_UNAVAILABLE', {
            message: 'Email requests are temporarily unavailable',
          });
        }
        if (!allowed)
          throw new APIError('TOO_MANY_REQUESTS', {
            message: 'Please wait before requesting another email',
          });
      }),
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 15,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 1800,
      sendResetPassword: ({ user, url }) =>
        sendEmail({ kind: 'reset-password', to: user.email, url }),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      sendVerificationEmail: ({ user, url }) =>
        sendEmail({ kind: 'verify-email', to: user.email, url }),
    },
    session: {
      expiresIn: 604800,
      updateAge: 86400,
      cookieCache: { enabled: false },
    },
    verification: { storeIdentifier: 'hashed' },
    account: { accountLinking: { enabled: false } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 30 },
    advanced: {
      useSecureCookies: config.baseURL.startsWith('https:'),
      cookiePrefix: 'pointrush',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      // MUST be stripped and set by our HTTP boundary, never accepted from the client.
      ipAddress: { ipAddressHeaders: ['x-pointrush-client-ip'] },
    },
  });
}
