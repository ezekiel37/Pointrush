import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { BillsController } from './bills.controller.js';
import { BillsService } from './bills.service.js';
import { TestBillProvider } from './provider.js';
import type { BillProvider } from './provider.js';

export function billProvider(config?: { provider: 'test' }) {
  // A real provider adapter is added once one is chosen.
  if (config?.provider === 'test') return new TestBillProvider();
  return undefined;
}

@Module({})
export class BillsModule {
  static forRoot(provider?: BillProvider): DynamicModule {
    return {
      module: BillsModule,
      controllers: [BillsController],
      providers: [
        {
          provide: BillsService,
          inject: [DatabaseService],
          useFactory: (db: DatabaseService) =>
            new BillsService(db.db, provider),
        },
      ],
    };
  }
}
