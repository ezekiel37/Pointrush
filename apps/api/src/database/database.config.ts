import type { PoolConfig } from 'pg';
import { z } from 'zod';

const poolSize = z.coerce.number().int().min(1).max(20).default(5);

export interface DatabaseConfig {
  connectionString: string;
  ssl: false | { rejectUnauthorized: true; ca?: string };
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
  // Providers such as Supabase sign their certificates with their own root
  // certificate. DATABASE_CA_CERT adds it so verification still happens;
  // without it only publicly trusted certificates are accepted.
  const ca =
    input.DATABASE_CA_CERT === undefined
      ? undefined
      : normalizeCertificates(input.DATABASE_CA_CERT);
  const size = poolSize.safeParse(input.DATABASE_POOL_MAX);
  if (!size.success) throw new Error('Invalid DATABASE_POOL_MAX');
  return {
    connectionString: url.toString(),
    ssl:
      mode === 'disable-local'
        ? false
        : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
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

// Dashboards often turn a pasted certificate into one line (or keep literal
// "\n"). Rebuild standard PEM blocks: header, base64 in 64-character lines,
// footer. Anything that is not a certificate block is refused.
function normalizeCertificates(raw: string): string {
  const text = raw.replace(/\\n/g, '\n');
  const blocks = [
    ...text.matchAll(
      /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g,
    ),
  ];
  const rest = text
    .replace(
      /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
      '',
    )
    .trim();
  const bodies = blocks.map((block) => block[1]!.replace(/\s+/g, ''));
  if (
    bodies.length === 0 ||
    rest !== '' ||
    bodies.some((body) => !/^[A-Za-z0-9+/]+={0,2}$/.test(body))
  )
    throw new Error('Invalid DATABASE_CA_CERT');
  return bodies
    .map(
      (body) =>
        `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----`,
    )
    .join('\n');
}
