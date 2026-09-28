import { z } from 'zod';
import { readDatabaseConfig } from '../database/database.config.js';
import type { DatabaseConfig } from '../database/database.config.js';

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
});

export interface Environment {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  corsOrigins: string[];
  database?: DatabaseConfig;
}

export function readEnvironment(input: NodeJS.ProcessEnv): Environment {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.'));
    throw new Error(`Invalid environment configuration: ${fields.join(', ')}`);
  }
  const { NODE_ENV, PORT, CORS_ORIGINS } = result.data;
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
  return {
    nodeEnv: NODE_ENV,
    port: PORT,
    corsOrigins: [...new Set(origins)],
    ...(database ? { database } : {}),
  };
}
