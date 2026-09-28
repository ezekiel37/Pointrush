import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { DatabaseModule } from './database/database.module.js';
import { AccountsModule } from './accounts/accounts.module.js';
import type { DatabaseConfig } from './database/database.config.js';
import type { AuthEnvironment } from './config/environment.js';
import { createQueuedAuthEmail } from './auth/email-queue.js';
import { AuthModule } from './auth/auth.module.js';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { AuthService } from './auth/auth.service.js';
import { SessionGuard } from './auth/session.guard.js';
import { AccountsService } from './accounts/accounts.service.js';

@Module({})
export class AppModule {
  static forRoot(
    database?: DatabaseConfig,
    auth?: AuthEnvironment,
  ): DynamicModule {
    const imports: DynamicModule['imports'] = [
      DatabaseModule.forRoot(database),
      AccountsModule,
    ];
    if (auth) {
      imports.push(
        AuthModule.forRoot(
          {
            secret: auth.secret,
            baseURL: auth.baseURL,
            trustedOrigins: auth.trustedOrigins,
          },
          createQueuedAuthEmail(auth.emailEncryptionKey, auth.emailFrom),
          auth.dailyEmailLimit,
        ),
      );
    }
    return {
      module: AppModule,
      imports,
      controllers: [HealthController],
      providers: [
        {
          provide: APP_GUARD,
          inject: [
            Reflector,
            AccountsService,
            { token: AuthService, optional: true },
          ],
          useFactory: (
            reflector: Reflector,
            accounts: AccountsService,
            service?: AuthService,
          ) => new SessionGuard(reflector, accounts, service),
        },
      ],
    };
  }
}
