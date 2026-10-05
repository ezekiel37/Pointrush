import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { SmsEnvironment } from '../config/environment.js';
import { DatabaseService } from '../database/database.service.js';
import { PhoneController } from './phone.controller.js';
import { defaultPhoneConfig, PhoneService } from './phone.service.js';
import type { PhoneConfig } from './phone.service.js';
import { TestSmsProvider } from './sms.js';
import type { SmsProvider } from './sms.js';

export function smsProvider(config?: SmsEnvironment): SmsProvider | undefined {
  // A real SMS adapter is added once a provider is chosen.
  if (config?.provider === 'test') return new TestSmsProvider();
  return undefined;
}

@Module({})
export class PhoneModule {
  static forRoot(sms?: SmsProvider, config?: PhoneConfig): DynamicModule {
    return {
      module: PhoneModule,
      controllers: [PhoneController],
      providers: [
        {
          provide: PhoneService,
          inject: [DatabaseService],
          useFactory: (db: DatabaseService) =>
            new PhoneService(db.db, sms, config ?? defaultPhoneConfig),
        },
      ],
    };
  }
}
