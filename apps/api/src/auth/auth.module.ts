import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { SendAuthEmail } from './auth.email.js';
import { createAuth } from './auth.factory.js';
import type { AuthConfig } from './auth.factory.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AccountsModule } from '../accounts/accounts.module.js';

@Module({})
export class AuthModule {
  static forRoot(config: AuthConfig, sendEmail: SendAuthEmail): DynamicModule {
    return {
      module: AuthModule,
      imports: [AccountsModule],
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          inject: [DatabaseService],
          useFactory: (database: DatabaseService) =>
            new AuthService(
              createAuth(database.db, config, sendEmail),
              config.baseURL,
            ),
        },
      ],
      exports: [AuthService],
    };
  }
}
