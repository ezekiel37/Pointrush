import { z } from 'zod';
import { readDatabaseConfig } from '../database/database.config.js';
import type { DatabaseConfig } from '../database/database.config.js';
import {
  assertTrustedOrigin,
  emailEncryptionKey,
  parseEnvironment,
} from './validation.js';

export interface AuthEnvironment {
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  emailFrom: string;
  // Replies to account emails go here (for example support@acticlaim.com).
  emailReplyTo?: string;
  emailEncryptionKey: string;
  dailyEmailLimit?: number;
}

const schema = z.object({
  SPONSOR_TERMS_VERSION: z.string().trim().min(1).max(80).optional(),
  // Paid small tasks ("jobs"); "off" hides them.
  FEATURE_JOBS: z.enum(['on', 'off']).default('on'),
  // Send queued emails and payouts from the server itself; "off" leaves them
  // to external scheduled jobs (the worker CLIs).
  INLINE_WORKERS: z.enum(['on', 'off']).default('on'),
  RESEND_API_KEY: z.string().trim().min(1).optional(),
  // Only the signing test provider exists until the Bachs adapter is built.
  PAYMENTS_PROVIDER: z.enum(['test', 'bachs']).optional(),
  PAYMENTS_WEBHOOK_SECRET: z
    .string()
    .refine((value) => value.trim().length >= 16)
    .optional(),
  // Bachs secret key: sk_sandbox_ for testing, sk_live_ for real money.
  BACHS_API_KEY: z
    .string()
    .regex(/^sk_(sandbox|live)_[A-Za-z0-9_-]{8,}$/)
    .optional(),
  // Web app origin customers return to after paying, e.g. https://acticlaim.com
  PAYMENTS_RETURN_ORIGIN: z.string().optional(),
  // Only the in-memory test provider exists until an SMS adapter is chosen.
  SMS_PROVIDER: z.enum(['test']).optional(),
  // Airtime, data, electricity and TV from the wallet. Off until a provider
  // is chosen; only the test provider exists so far.
  BILLS_PROVIDER: z.enum(['off', 'test']).default('off'),
  // Reviewer account IDs that may change minimums and referral rewards in
  // the admin settings, comma separated. Empty: settings are read-only.
  SETTINGS_ADMIN_ACCOUNT_IDS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.uuid())),
  // Country calling codes SMS may go to, e.g. "+234,+233". Limits SMS fraud.
  SMS_ALLOWED_PREFIXES: z
    .string()
    .default('+234')
    .transform((v) =>
      v
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().regex(/^\+[1-9]\d{0,3}$/)).min(1)),
  SMS_DAILY_LIMIT: z
    .string()
    .regex(/^\d+$/)
    .default('500')
    .transform(Number)
    .pipe(z.number().int().min(1).max(100000)),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z
    .string()
    .regex(/^\d+$/)
    .default('8080')
    .transform(Number)
    .pipe(z.number().int().min(1).max(65535)),
  CORS_ORIGINS: z.string().default(''),
  AUTH_SECRET: z
    .string()
    .refine((value) => value.trim().length >= 32)
    .optional(),
  AUTH_BASE_URL: z.string().optional(),
  AUTH_TRUSTED_ORIGINS: z.string().optional(),
  EMAIL_FROM: z.email().optional(),
  EMAIL_REPLY_TO: z.email().optional(),
  AUTH_EMAIL_ENCRYPTION_KEY: emailEncryptionKey.optional(),
  AUTH_EMAIL_DAILY_LIMIT: z
    .string()
    .regex(/^\d+$/)
    .default('100')
    .transform(Number)
    .pipe(z.number().int().min(1).max(10000)),
});

export type PaymentsEnvironment =
  | { provider: 'test'; webhookSecret: string }
  | {
      provider: 'bachs';
      webhookSecret: string;
      apiKey: string;
      returnOrigin: string;
    };

export interface SmsEnvironment {
  provider: 'test';
  allowedPrefixes: string[];
  dailyLimit: number;
}

export interface Environment {
  sponsorTermsVersion?: string;
  jobsEnabled?: boolean;
  inlineWorkers?: boolean;
  resendApiKey?: string;
  payments?: PaymentsEnvironment;
  sms?: SmsEnvironment;
  bills?: { provider: 'test' };
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  corsOrigins: string[];
  database?: DatabaseConfig;
  auth?: AuthEnvironment;
}

export function readEnvironment(input: NodeJS.ProcessEnv): Environment {
  const {
    SPONSOR_TERMS_VERSION,
    FEATURE_JOBS,
    INLINE_WORKERS,
    RESEND_API_KEY,
    PAYMENTS_PROVIDER,
    PAYMENTS_WEBHOOK_SECRET,
    BILLS_PROVIDER,
    BACHS_API_KEY,
    PAYMENTS_RETURN_ORIGIN,
    SMS_PROVIDER,
    SMS_ALLOWED_PREFIXES,
    SMS_DAILY_LIMIT,
    NODE_ENV,
    PORT,
    CORS_ORIGINS,
    AUTH_SECRET,
    AUTH_BASE_URL,
    AUTH_TRUSTED_ORIGINS,
    EMAIL_FROM,
    EMAIL_REPLY_TO,
    AUTH_EMAIL_ENCRYPTION_KEY,
    AUTH_EMAIL_DAILY_LIMIT,
  } = parseEnvironment(schema, input);
  const origins = CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (NODE_ENV === 'production' && origins.length === 0) {
    throw new Error('CORS_ORIGINS must be explicitly configured in production');
  }
  for (const origin of origins) {
    assertTrustedOrigin(origin, 'CORS_ORIGINS', NODE_ENV === 'production');
  }
  if (Boolean(PAYMENTS_PROVIDER) !== Boolean(PAYMENTS_WEBHOOK_SECRET)) {
    throw new Error('Payments configuration must be complete');
  }
  if (PAYMENTS_PROVIDER === 'test' && NODE_ENV === 'production') {
    throw new Error('The test payment provider cannot run in production');
  }
  if (PAYMENTS_PROVIDER === 'bachs') {
    if (!BACHS_API_KEY || !PAYMENTS_RETURN_ORIGIN)
      throw new Error('Payments configuration must be complete');
    assertTrustedOrigin(
      PAYMENTS_RETURN_ORIGIN,
      'PAYMENTS_RETURN_ORIGIN',
      NODE_ENV === 'production',
    );
    // Live keys (real money) only in production. Production may also run on
    // a sandbox key while the service is being tried out; switching to live
    // is a key change (see LAUNCH.md).
    if (NODE_ENV !== 'production' && BACHS_API_KEY.startsWith('sk_live_'))
      throw new Error('A sk_live_ Bachs key can only be used in production');
  } else if (BACHS_API_KEY) {
    throw new Error('BACHS_API_KEY is set but PAYMENTS_PROVIDER is not bachs');
  }
  if (BILLS_PROVIDER === 'test' && NODE_ENV === 'production') {
    throw new Error('The test bills provider cannot run in production');
  }
  if (SMS_PROVIDER === 'test' && NODE_ENV === 'production') {
    throw new Error('The test SMS provider cannot run in production');
  }
  const database = readDatabaseConfig(input);
  const authValues = [
    AUTH_SECRET,
    AUTH_BASE_URL,
    EMAIL_FROM,
    AUTH_EMAIL_ENCRYPTION_KEY,
  ];
  if (authValues.some(Boolean) && authValues.some((value) => !value)) {
    throw new Error('Authentication configuration must be complete');
  }
  if (NODE_ENV === 'production' && authValues.some((value) => !value)) {
    throw new Error('Authentication configuration is required in production');
  }
  let auth: AuthEnvironment | undefined;
  if (AUTH_SECRET && AUTH_BASE_URL && EMAIL_FROM && AUTH_EMAIL_ENCRYPTION_KEY) {
    assertTrustedOrigin(
      AUTH_BASE_URL,
      'AUTH_BASE_URL',
      NODE_ENV === 'production',
    );
    const trustedOrigins = (AUTH_TRUSTED_ORIGINS ?? CORS_ORIGINS)
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    for (const origin of trustedOrigins) {
      assertTrustedOrigin(
        origin,
        'AUTH_TRUSTED_ORIGINS',
        NODE_ENV === 'production',
      );
    }
    auth = {
      secret: AUTH_SECRET,
      baseURL: AUTH_BASE_URL,
      trustedOrigins: [...new Set(trustedOrigins)],
      emailFrom: EMAIL_FROM,
      ...(EMAIL_REPLY_TO ? { emailReplyTo: EMAIL_REPLY_TO } : {}),
      emailEncryptionKey: AUTH_EMAIL_ENCRYPTION_KEY,
      dailyEmailLimit: AUTH_EMAIL_DAILY_LIMIT,
    };
  }
  return {
    jobsEnabled: FEATURE_JOBS === 'on',
    inlineWorkers: INLINE_WORKERS === 'on',
    ...(RESEND_API_KEY ? { resendApiKey: RESEND_API_KEY } : {}),
    ...(SPONSOR_TERMS_VERSION
      ? { sponsorTermsVersion: SPONSOR_TERMS_VERSION }
      : {}),
    ...(PAYMENTS_PROVIDER && PAYMENTS_WEBHOOK_SECRET
      ? {
          payments:
            PAYMENTS_PROVIDER === 'bachs'
              ? {
                  provider: 'bachs' as const,
                  webhookSecret: PAYMENTS_WEBHOOK_SECRET,
                  apiKey: BACHS_API_KEY!,
                  returnOrigin: PAYMENTS_RETURN_ORIGIN!,
                }
              : {
                  provider: 'test' as const,
                  webhookSecret: PAYMENTS_WEBHOOK_SECRET,
                },
        }
      : {}),
    ...(SMS_PROVIDER
      ? {
          sms: {
            provider: SMS_PROVIDER,
            allowedPrefixes: SMS_ALLOWED_PREFIXES,
            dailyLimit: SMS_DAILY_LIMIT,
          },
        }
      : {}),
    ...(BILLS_PROVIDER === 'test'
      ? { bills: { provider: 'test' as const } }
      : {}),
    nodeEnv: NODE_ENV,
    port: PORT,
    corsOrigins: [...new Set(origins)],
    ...(database ? { database } : {}),
    ...(auth ? { auth } : {}),
  };
}
