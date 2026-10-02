import 'reflect-metadata';
import { readDatabaseConfig } from '../database/database.config.js';
import { DatabaseService } from '../database/database.service.js';
import { authorizeOperatorToken } from './operator-token.js';
import { MfaRecoveryService } from './mfa-recovery.js';

function option(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Missing --${name}`);
  return value;
}

let database: DatabaseService | undefined;
try {
  const operatorId = process.env.MFA_RECOVERY_OPERATOR_ACCOUNT_ID;
  const token = process.env.MFA_RECOVERY_OPERATOR_TOKEN;
  const tokenHash = process.env.MFA_RECOVERY_OPERATOR_TOKEN_SHA256;
  if (!operatorId || !token || !tokenHash)
    throw new Error('MFA recovery operator configuration is required');
  authorizeOperatorToken(tokenHash, token);
  const config = readDatabaseConfig(process.env, 'MFA_RECOVERY_DATABASE_URL');
  if (!config) throw new Error('MFA recovery database is required');
  database = new DatabaseService(config);
  const result = await new MfaRecoveryService(database.db).resetFactor({
    requestId: option('request-id'),
    operatorAccountId: operatorId,
    targetAuthUserId: option('target-user-id'),
    reason: option('reason'),
    ...(process.argv.includes('--evidence-ref')
      ? { evidenceRef: option('evidence-ref') }
      : {}),
  });
  process.stdout.write(
    JSON.stringify({ id: result.id, requestId: result.requestId }) + '\n',
  );
} catch {
  process.stderr.write(
    'MFA recovery failed. Check authorization, target, request and database configuration.\n',
  );
  process.exitCode = 1;
} finally {
  await database?.onApplicationShutdown();
}
