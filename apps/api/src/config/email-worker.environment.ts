import { z } from 'zod';
import { readDatabaseConfig } from '../database/database.config.js';
import { emailEncryptionKey, parseEnvironment } from './validation.js';

const schema = z.object({
  RESEND_API_KEY: z.string().trim().min(1),
  AUTH_EMAIL_ENCRYPTION_KEY: emailEncryptionKey,
  EMAIL_WORKER_MAX_DURATION_MS: z
    .string()
    .regex(/^\d+$/)
    .default('60000')
    .transform(Number)
    .pipe(z.number().int().min(1000).max(300000)),
});

// Delivery consumes the encrypted message snapshot; no auth secret, sender,
// browser origins, HTTP port or migration credentials belong to this process.
export function readEmailWorkerEnvironment(input: NodeJS.ProcessEnv) {
  const config = parseEnvironment(schema, input);
  const database = readDatabaseConfig(input);
  if (!database)
    throw new Error('DATABASE_URL is required for the email worker');
  return {
    database,
    resendApiKey: config.RESEND_API_KEY,
    emailEncryptionKey: config.AUTH_EMAIL_ENCRYPTION_KEY,
    maxDurationMs: config.EMAIL_WORKER_MAX_DURATION_MS,
  };
}
