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
import { DatabaseService } from './database/database.service.js';
import { SponsorsService } from './sponsors/sponsors.service.js';
import { SponsorsController } from './sponsors/sponsors.controller.js';
import { TaskWorkModule } from './tasks/task-work.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { CampaignsModule } from './campaigns/campaigns.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import type { PaymentProvider } from './payments/provider.js';
import { PhoneModule } from './phone/phone.module.js';
import type { PhoneConfig } from './phone/phone.service.js';
import type { SmsProvider } from './phone/sms.js';
import { RateLimitGuard } from './http/rate-limit.js';
import { BillsModule } from './bills/bills.module.js';
import type { BillProvider } from './bills/provider.js';
import { FilesModule } from './files/files.module.js';
import type { FileStorage } from './files/storage.js';

@Module({})
export class AppModule {
  static forRoot(
    database?: DatabaseConfig,
    auth?: AuthEnvironment,
    sponsorTermsVersion?: string,
    payments?: PaymentProvider,
    sms?: { provider?: SmsProvider; config?: PhoneConfig },
    features: { jobs: boolean } = { jobs: true },
    bills?: BillProvider,
    storage?: FileStorage,
  ): DynamicModule {
    const imports: DynamicModule['imports'] = [
      DatabaseModule.forRoot(database),
      AccountsModule,
    ];
    if (database)
      imports.push(
        ReviewsModule,
        TaskWorkModule,
        CampaignsModule,
        PaymentsModule.forRoot(payments, auth),
        PhoneModule.forRoot(sms?.provider, sms?.config),
        BillsModule.forRoot(bills),
        FilesModule.forRoot(storage),
      );
    if (auth) {
      imports.push(
        AuthModule.forRoot(
          {
            secret: auth.secret,
            baseURL: auth.baseURL,
            trustedOrigins: auth.trustedOrigins,
          },
          createQueuedAuthEmail(
            auth.emailEncryptionKey,
            auth.emailFrom,
            auth.emailReplyTo,
          ),
          auth.dailyEmailLimit,
        ),
      );
    }
    return {
      module: AppModule,
      imports,
      controllers: [HealthController, SponsorsController],
      providers: [
        {
          provide: SponsorsService,
          inject: [DatabaseService],
          useFactory: (database: DatabaseService) =>
            new SponsorsService(database, sponsorTermsVersion, features.jobs),
        },
        {
          provide: APP_GUARD,
          inject: [
            Reflector,
            AccountsService,
            { token: AuthService, optional: true },
            DatabaseService,
          ],
          useFactory: (
            reflector: Reflector,
            accounts: AccountsService,
            service?: AuthService,
            database?: DatabaseService,
          ) => new SessionGuard(reflector, accounts, service, database),
        },
        // Runs after the session guard, so signed-in traffic is limited per account.
        {
          provide: APP_GUARD,
          inject: [Reflector],
          useFactory: (reflector: Reflector) => new RateLimitGuard(reflector),
        },
      ],
    };
  }
}
