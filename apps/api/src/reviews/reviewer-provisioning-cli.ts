import 'reflect-metadata';
import { readDatabaseConfig } from '../database/database.config.js';
import { DatabaseService } from '../database/database.service.js';
import {
  authorizeReviewerOperator,
  ReviewerProvisioningService,
} from './reviewer-provisioning.js';

function option(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Missing --${name}`);
  return value;
}

function usage(): never {
  throw new Error(
    'Usage: [--preview] grant --grant-id UUID --reviewer-id UUID --reason TEXT --expires-at ISO_DATE | [--preview] revoke --grant-id UUID --reason TEXT',
  );
}

let database: DatabaseService | undefined;
try {
  const operation = process.argv[2];
  const preview = process.argv.includes('--preview');
  const command = preview ? process.argv[3] : operation;
  if (command !== 'grant' && command !== 'revoke') usage();
  const operatorId = process.env.REVIEWER_OPERATOR_ACCOUNT_ID;
  const token = process.env.REVIEWER_OPERATOR_TOKEN;
  if (!operatorId || !token)
    throw new Error('Reviewer operator configuration is required');
  const tokenHash = process.env.REVIEWER_OPERATOR_TOKEN_SHA256;
  if (!tokenHash) throw new Error('Reviewer operator token hash is required');
  authorizeReviewerOperator({ accountId: operatorId, tokenHash }, token);
  const config = readDatabaseConfig(
    process.env,
    'REVIEWER_PROVISIONING_DATABASE_URL',
  );
  if (!config) throw new Error('Reviewer provisioning database is required');
  database = new DatabaseService(config);
  const service = new ReviewerProvisioningService(
    database.db,
    30 * 24 * 60 * 60 * 1000,
  );
  const result =
    command === 'grant'
      ? preview
        ? await service.previewGrant(operatorId, {
            grantId: option('grant-id'),
            reviewerId: option('reviewer-id'),
            reason: option('reason'),
            expiresAt: new Date(option('expires-at')),
          })
        : await service.grant(operatorId, {
            grantId: option('grant-id'),
            reviewerId: option('reviewer-id'),
            reason: option('reason'),
            expiresAt: new Date(option('expires-at')),
          })
      : preview
        ? await service.previewRevoke(operatorId, {
            grantId: option('grant-id'),
            reason: option('reason'),
          })
        : await service.revoke(operatorId, {
            grantId: option('grant-id'),
            reason: option('reason'),
          });
  process.stdout.write(
    JSON.stringify({
      operation: command,
      preview,
      grantId: 'id' in result ? result.id : result.grantId,
      reviewerId: 'reviewerId' in result ? result.reviewerId : undefined,
      status: 'status' in result ? result.status : 'applied',
    }) + '\n',
  );
} catch {
  process.stderr.write(
    'Reviewer provisioning failed. Check the operation, authorization, target account and database configuration.\n',
  );
  process.exitCode = 1;
} finally {
  await database?.onApplicationShutdown();
}
