import 'reflect-metadata';
import { readEnvironment } from '../config/environment.js';
import { DatabaseService } from '../database/database.service.js';
import { paymentProvider } from './payments.module.js';
import { PaymentsService } from './payments.service.js';

// Finite batch for a scheduler (for example every five minutes): hands held
// withdrawals to the payment provider once each. Safe to overlap or re-run:
// the withdrawal ID is the provider idempotency key.
let database: DatabaseService | undefined;
try {
  const config = readEnvironment(process.env);
  const provider = paymentProvider(config.payments);
  if (!config.database || !provider)
    throw new Error('Database and payments configuration are required');
  database = new DatabaseService(config.database);
  const result = await new PaymentsService(
    database.db,
    provider,
  ).submitPendingWithdrawals(50);
  process.stdout.write(
    JSON.stringify({ event: 'payout_batch', ...result }) + '\n',
  );
  // Deferred payouts (provider down, balance short) need a person to look.
  if (result.deferred) process.exitCode = 2;
} catch {
  process.stderr.write(
    'Payout worker failed. Check configuration and database availability.\n',
  );
  process.exitCode = 1;
} finally {
  await database?.onApplicationShutdown().catch(() => {
    process.exitCode = 1;
  });
}
