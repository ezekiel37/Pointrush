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
  emailEncryptionKey: string;
  dailyEmailLimit?: number;
}

const schema = z.object({
  SPONSOR_TERMS_VERSION: z.string().trim().min(1).max(80).optional(),
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
  AUTH_EMAIL_ENCRYPTION_KEY: emailEncryptionKey.optional(),
  AUTH_EMAIL_DAILY_LIMIT: z
    .string()
    .regex(/^\d+$/)
    .default('100')
    .transform(Number)
    .pipe(z.number().int().min(1).max(10000)),
});

export interface Environment {
  sponsorTermsVersion?: string;
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  corsOrigins: string[];
  database?: DatabaseConfig;
  auth?: AuthEnvironment;
}

export function readEnvironment(input: NodeJS.ProcessEnv): Environment {
  const {
    SPONSOR_TERMS_VERSION,
    NODE_ENV,
    PORT,
    CORS_ORIGINS,
    AUTH_SECRET,
    AUTH_BASE_URL,
    AUTH_TRUSTED_ORIGINS,
    EMAIL_FROM,
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
      emailEncryptionKey: AUTH_EMAIL_ENCRYPTION_KEY,
      dailyEmailLimit: AUTH_EMAIL_DAILY_LIMIT,
    };
  }
  return {
    ...(SPONSOR_TERMS_VERSION
      ? { sponsorTermsVersion: SPONSOR_TERMS_VERSION }
      : {}),
    nodeEnv: NODE_ENV,
    port: PORT,
    corsOrigins: [...new Set(origins)],
    ...(database ? { database } : {}),
    ...(auth ? { auth } : {}),
  };
}
