import 'reflect-metadata';
import { readEmailWorkerEnvironment } from '../config/email-worker.environment.js';
import { DatabaseService } from '../database/database.service.js';
import { safeErrorSummary } from '../database/safe-error.js';
import { createResendPayloadSender } from './auth.email.js';
import { EmailWorker } from './email-worker.js';

let database: DatabaseService | undefined;
let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
try {
  const config = readEmailWorkerEnvironment(process.env);
  const deadline = performance.now() + config.maxDurationMs;
  // CLI-only watchdog includes DB waits, delivery, pruning and pool shutdown.
  // Termination may leave an uncertain send; lease recovery reuses the job's
  // original provider idempotency key. Never mark interrupted work accepted.
  deadlineTimer = setTimeout(() => {
    process.stderr.write(
      JSON.stringify({ event: 'auth_email_batch_deadline' }) + '\n',
    );
    process.exit(1);
  }, config.maxDurationMs);
  database = new DatabaseService(config.database);
  const worker = new EmailWorker(
    database.db,
    config.emailEncryptionKey,
    createResendPayloadSender(config.resendApiKey),
  );
  const outcomes: Record<string, number> = {};
  // Finite batch: external job/event invocation owns scheduling and restart.
  for (let count = 0; count < 25 && performance.now() < deadline; count++) {
    const result = await worker.runOne();
    outcomes[result] = (outcomes[result] ?? 0) + 1;
    if (result === 'idle') break;
  }
  await worker.prune();
  process.stdout.write(
    JSON.stringify({ event: 'auth_email_batch', outcomes }) + '\n',
  );
  if (outcomes.dead || outcomes.stale) process.exitCode = 1;
} catch (error) {
  process.stderr.write(
    `Authentication email worker failed. Check configuration and database availability. Cause: ${safeErrorSummary(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  try {
    await database?.onApplicationShutdown();
  } catch {
    process.stderr.write('Authentication email worker cleanup failed.\n');
    process.exitCode = 1;
  } finally {
    clearTimeout(deadlineTimer);
  }
}
