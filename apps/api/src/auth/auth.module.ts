import { Logger, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { SendAuthEmail } from './auth.email.js';
import { createAuth } from './auth.factory.js';
import type { AuthConfig } from './auth.factory.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AuthEmailBudget, protectAuthEmail } from './auth.email-budget.js';

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
              createAuth(
                database.db,
                config,
                protectAuthEmail(sendEmail, (event) => {
                  logger.log({ event });
                }),
                async (recipient) => {
                  try {
                    const allowed = await budget.claim(recipient);
                    if (!allowed) logger.log({ event: 'auth_email_limited' });
                    return allowed;
                  } catch {
                    logger.error({ event: 'auth_email_budget_failed' });
                    throw new Error('Email budget unavailable');
                  }
                },
              ),
              config.baseURL,
              config.trustedOrigins,
            );
          },
        },
      ],
      exports: [AuthService],
    };
  }
}
