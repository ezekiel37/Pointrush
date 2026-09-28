import { Module } from '@nestjs/common';
import { AccountsRepository } from './accounts.repository.js';
import { AccountsService } from './accounts.service.js';

@Module({
  providers: [AccountsRepository, AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
