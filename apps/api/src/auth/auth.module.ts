import { Logger, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { SendAuthEmail } from './auth.email.js';
import { createAuth } from './auth.factory.js';
import type { AuthConfig } from './auth.factory.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AuthEmailBudget } from './auth.email-budget.js';
import { authEmailJobs } from './email-queue.schema.js';
import { SessionManagementService } from './session-management.js';

@Module({})
export class AuthModule {
  static forRoot(
    config: AuthConfig,
    sendEmail: SendAuthEmail,
    dailyEmailLimit = 100,
  ): DynamicModule {
    return {
      module: AuthModule,
      imports: [AccountsModule],
      controllers: [AuthController],
      providers: [
        {
          provide: SessionManagementService,
          inject: [DatabaseService],
          useFactory: (database: DatabaseService) =>
            new SessionManagementService(database.db),
        },
        {
          provide: AuthService,
          inject: [DatabaseService],
          useFactory: (database: DatabaseService) => {
            const logger = new Logger('AuthEmail');
            const budget = new AuthEmailBudget(
              database.db,
              config.secret,
              dailyEmailLimit,
            );
            return new AuthService(
              createAuth(database.db, config, sendEmail, async (recipient) => {
                try {
                  // Do this for known and unknown recipients alike, before
                  // lookup, so a missing queue migration fails uniformly.
                  await database.db
                    .select({ id: authEmailJobs.id })
                    .from(authEmailJobs)
                    .limit(0);
                  const allowed = await budget.claim(recipient);
                  if (!allowed) logger.log({ event: 'auth_email_limited' });
                  return allowed;
                } catch {
                  logger.error({ event: 'auth_email_budget_failed' });
                  throw new Error('Email budget unavailable');
                }
              }),
              config.baseURL,
              config.trustedOrigins,
            );
          },
        },
      ],
      exports: [AuthService, SessionManagementService],
    };
  }
}
