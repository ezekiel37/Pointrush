import type { PoolConfig } from 'pg';
import { z } from 'zod';

const poolSize = z.coerce.number().int().min(1).max(20).default(5);

export interface DatabaseConfig {
  connectionString: string;
  ssl: false | { rejectUnauthorized: true };
  max: number;
}

export function readDatabaseConfig(
  input: NodeJS.ProcessEnv,
  key:
    | 'DATABASE_URL'
    | 'MIGRATION_DATABASE_URL'
    | 'REVIEWER_PROVISIONING_DATABASE_URL'
    | 'MFA_RECOVERY_DATABASE_URL' = 'DATABASE_URL',
): DatabaseConfig | undefined {
  const raw = input[key];
  if (!raw) {
    if (input.NODE_ENV === 'production' || key !== 'DATABASE_URL') {
      throw new Error(`${key} is required`);
    }
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid ${key}`);
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    url.pathname.length < 2 ||
    url.hash
  ) {
    throw new Error(`Invalid ${key}`);
  }
  // pg connection-string SSL parameters override explicit TLS options. Accept only
  // verify-full, then remove it so certificate validation cannot be weakened.
  for (const [name, value] of url.searchParams) {
    if (name !== 'sslmode' || value !== 'verify-full') {
      throw new Error(`${key} contains unsupported connection options`);
    }
  }
  const explicitTls = url.searchParams.has('sslmode');
  url.search = '';
  const mode = input.DATABASE_SSL_MODE ?? 'verify-full';
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    !['verify-full', 'disable-local'].includes(mode) ||
    (mode === 'disable-local' && (!local || explicitTls))
  ) {
    throw new Error(
      'DATABASE_SSL_MODE must verify TLS except for explicit local development',
    );
  }
  const size = poolSize.safeParse(input.DATABASE_POOL_MAX);
  if (!size.success) throw new Error('Invalid DATABASE_POOL_MAX');
  return {
    connectionString: url.toString(),
    ssl: mode === 'disable-local' ? false : { rejectUnauthorized: true },
    max: size.data,
  };
}

export function poolOptions(config: DatabaseConfig): PoolConfig {
  return {
    ...config,
    application_name: 'pointrush-api',
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30000,
    statement_timeout: 5000,
    query_timeout: 6000,
    idle_in_transaction_session_timeout: 5000,
  };
}
