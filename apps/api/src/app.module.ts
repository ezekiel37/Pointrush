import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { DatabaseModule } from './database/database.module.js';
import { AccountsModule } from './accounts/accounts.module.js';
import type { DatabaseConfig } from './database/database.config.js';

@Module({})
export class AppModule {
  static forRoot(database?: DatabaseConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [DatabaseModule.forRoot(database), AccountsModule],
      controllers: [HealthController],
    };
  }
}
