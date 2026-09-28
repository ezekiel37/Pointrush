import { z } from 'zod';
import { readDatabaseConfig } from '../database/database.config.js';
import type { DatabaseConfig } from '../database/database.config.js';

export interface AuthEnvironment {
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  resendApiKey: string;
  emailFrom: string;
  dailyEmailLimit?: number;
}

const schema = z.object({
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
  AUTH_SECRET: z.string().optional(),
  AUTH_BASE_URL: z.string().optional(),
  AUTH_TRUSTED_ORIGINS: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  AUTH_EMAIL_DAILY_LIMIT: z
    .string()
    .regex(/^\d+$/)
    .default('100')
    .transform(Number)
    .pipe(z.number().int().min(1).max(10000)),
});

export interface Environment {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  corsOrigins: string[];
  database?: DatabaseConfig;
  auth?: AuthEnvironment;
}

export function readEnvironment(input: NodeJS.ProcessEnv): Environment {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.'));
    throw new Error(`Invalid environment configuration: ${fields.join(', ')}`);
  }
  const {
    NODE_ENV,
    PORT,
    CORS_ORIGINS,
    AUTH_SECRET,
    AUTH_BASE_URL,
    AUTH_TRUSTED_ORIGINS,
    RESEND_API_KEY,
    EMAIL_FROM,
    AUTH_EMAIL_DAILY_LIMIT,
  } = result.data;
  const origins = CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (NODE_ENV === 'production' && origins.length === 0) {
    throw new Error('CORS_ORIGINS must be explicitly configured in production');
  }
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error('CORS_ORIGINS must contain valid origins');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== origin ||
      (NODE_ENV === 'production' && url.protocol !== 'https:')
    ) {
      throw new Error(
        'CORS_ORIGINS requires exact origins and production HTTPS',
      );
    }
  }
  const database = readDatabaseConfig(input);
  const authValues = [AUTH_SECRET, AUTH_BASE_URL, RESEND_API_KEY, EMAIL_FROM];
  if (authValues.some(Boolean) && authValues.some((value) => !value)) {
    throw new Error('Authentication configuration must be complete');
  }
  if (NODE_ENV === 'production' && authValues.some((value) => !value)) {
    throw new Error('Authentication configuration is required in production');
  }
  let auth: AuthEnvironment | undefined;
  if (AUTH_SECRET && AUTH_BASE_URL && RESEND_API_KEY && EMAIL_FROM) {
    let baseURL: URL;
    try {
      baseURL = new URL(AUTH_BASE_URL);
    } catch {
      throw new Error('AUTH_BASE_URL must be a valid URL');
    }
    if (baseURL.origin !== AUTH_BASE_URL || baseURL.protocol !== 'https:') {
      throw new Error('AUTH_BASE_URL must be an exact HTTPS origin');
    }
    const trustedOrigins = (AUTH_TRUSTED_ORIGINS ?? CORS_ORIGINS)
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    auth = {
      secret: AUTH_SECRET,
      baseURL: AUTH_BASE_URL,
      trustedOrigins: [...new Set(trustedOrigins)],
      resendApiKey: RESEND_API_KEY,
      emailFrom: EMAIL_FROM,
      dailyEmailLimit: AUTH_EMAIL_DAILY_LIMIT,
    };
  }
  return {
    nodeEnv: NODE_ENV,
    port: PORT,
    corsOrigins: [...new Set(origins)],
    ...(database ? { database } : {}),
    ...(auth ? { auth } : {}),
  };
}
