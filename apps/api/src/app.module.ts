import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { DatabaseModule } from './database/database.module.js';
import { AccountsModule } from './accounts/accounts.module.js';
import type { DatabaseConfig } from './database/database.config.js';
import type { AuthEnvironment } from './config/environment.js';
import { createResendAuthEmail } from './auth/auth.email.js';
import { AuthModule } from './auth/auth.module.js';

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
          createResendAuthEmail(auth.resendApiKey, auth.emailFrom),
        ),
      );
    }
    return {
      module: AppModule,
      imports,
      controllers: [HealthController],
    };
  }
}
