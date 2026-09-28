import 'reflect-metadata';
import { readEnvironment } from '../config/environment.js';
import { DatabaseService } from '../database/database.service.js';
import { createResendPayloadSender } from './auth.email.js';
import { EmailWorker } from './email-worker.js';

let database: DatabaseService | undefined;
try {
  const config = readEnvironment(process.env);
  if (!config.database || !config.auth)
    throw new Error('Worker configuration required');
  database = new DatabaseService(config.database);
  const worker = new EmailWorker(
    database.db,
    config.auth.emailEncryptionKey,
    createResendPayloadSender(config.auth.resendApiKey),
  );
  const outcomes: Record<string, number> = {};
  // Finite batch: external job/event invocation owns scheduling and restart.
  for (let count = 0; count < 25; count++) {
    const result = await worker.runOne();
    outcomes[result] = (outcomes[result] ?? 0) + 1;
    if (result === 'idle') break;
  }
  await worker.prune();
  process.stdout.write(
    JSON.stringify({ event: 'auth_email_batch', outcomes }) + '\n',
  );
  if (outcomes.dead || outcomes.stale) process.exitCode = 1;
} catch {
  process.stderr.write(
    'Authentication email worker failed. Check configuration and database availability.\n',
  );
  process.exitCode = 1;
} finally {
  await database?.onApplicationShutdown();
}
