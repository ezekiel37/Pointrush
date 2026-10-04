import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '@pointrush/contracts';
import { betterAuth } from 'better-auth';
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';
import {
  assertReviewerEnrollment,
  hasRecentAdminMfa,
  recordAdminMfa,
} from './admin-mfa.js';
import { z } from 'zod';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from '../database/schema.js';
import { authAdapterSchema } from './auth.schema.js';
import type { SendAuthEmail } from './auth.email.js';
import { emailQueuePlugin } from './email-queue.schema.js';
import { assertTrustedOrigin } from '../config/validation.js';

export interface AuthConfig {
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
}

function validateConfig(config: AuthConfig): void {
  if (config.secret.trim().length < 32)
    throw new Error('Auth secret must contain at least 32 characters');
  for (const origin of [config.baseURL, ...config.trustedOrigins]) {
    assertTrustedOrigin(origin, 'Auth');
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
    plugins: [
      emailQueuePlugin,
      twoFactor({ issuer: 'Acticlaim', skipVerificationOnEnable: false }),
    ],
    appName: 'Acticlaim',
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
        if (ctx.path.startsWith('/two-factor/')) {
          if (
            ctx.body?.trustDevice === true ||
            ctx.path === '/two-factor/disable'
          ) {
            throw new APIError('FORBIDDEN', {
              message: 'This MFA operation is not enabled',
            });
          }
          if (ctx.path === '/two-factor/enable') {
            const session = await getSessionFromCtx(ctx);
            if (!session) throw new APIError('UNAUTHORIZED');
            await assertReviewerEnrollment(db, session.user.id);
            if (ctx.body?.method && ctx.body.method !== 'totp')
              throw new APIError('BAD_REQUEST', {
                message: 'Use an authenticator app',
              });
          }
          if (
            ctx.path === '/two-factor/verify-totp' &&
            !z
              .string()
              .regex(/^\d{6}$/)
              .safeParse(ctx.body?.code).success
          ) {
            throw new APIError('BAD_REQUEST', {
              message: 'Enter a six-digit authenticator code',
            });
          }
          if (
            [
              '/two-factor/get-totp-uri',
              '/two-factor/generate-backup-codes',
            ].includes(ctx.path)
          ) {
            const session = await getSessionFromCtx(ctx);
            if (
              !session ||
              !(await hasRecentAdminMfa(
                db,
                session.session.id,
                session.user.id,
              ))
            )
              throw new APIError('FORBIDDEN', {
                message: 'Recent authenticator verification is required',
              });
          }
        }
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
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/two-factor/verify-totp') return;
        const result = ctx.context.returned;
        if (
          !result ||
          typeof result !== 'object' ||
          !('token' in result) ||
          typeof result.token !== 'string'
        )
          return;
        const verified = ctx.context.newSession ?? ctx.context.session;
        if (!verified)
          throw new APIError('FORBIDDEN', {
            message: 'MFA session is unavailable',
          });
        await recordAdminMfa(
          db,
          config.secret,
          verified.session.id,
          verified.user.id,
          ctx.body.code,
        );
      }),
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
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
