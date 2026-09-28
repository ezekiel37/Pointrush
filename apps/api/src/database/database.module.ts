import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { DatabaseConfig } from './database.config.js';
import { DATABASE_CONFIG, DatabaseService } from './database.service.js';

@Module({})
export class DatabaseModule {
  static forRoot(config: DatabaseConfig | undefined): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [
        { provide: DATABASE_CONFIG, useValue: config },
        DatabaseService,
      ],
      exports: [DatabaseService],
    };
  }
}
