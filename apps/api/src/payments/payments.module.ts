import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { PaymentsEnvironment } from '../config/environment.js';
import { DatabaseService } from '../database/database.service.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { TestPaymentProvider } from './provider.js';
import type { PaymentProvider } from './provider.js';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export function paymentProvider(
  config?: PaymentsEnvironment,
): PaymentProvider | undefined {
  // The Bachs adapter is added once its documentation is reviewed.
  if (config?.provider === 'test')
    return new TestPaymentProvider(config.webhookSecret);
  return undefined;
}

@Module({})
export class PaymentsModule {
  static forRoot(provider?: PaymentProvider): DynamicModule {
    return {
      module: PaymentsModule,
      controllers: [PaymentsController],
      providers: [
        { provide: PAYMENT_PROVIDER, useValue: provider ?? null },
        {
          provide: PaymentsService,
          inject: [DatabaseService, PAYMENT_PROVIDER],
          useFactory: (db: DatabaseService, value: PaymentProvider | null) =>
            new PaymentsService(db.db, value ?? undefined),
        },
      ],
    };
  }
}
