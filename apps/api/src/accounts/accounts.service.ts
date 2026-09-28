import { Inject, Injectable } from '@nestjs/common';
import { AccountsRepository } from './accounts.repository.js';
import type { AccountIdentity } from './accounts.repository.js';
import { AccountError } from './account.error.js';
import {
  accountIdSchema,
  createAccountSchema,
  parseAccountInput,
  renameAccountSchema,
} from './account.validation.js';

@Injectable()
export class AccountsService {
  constructor(
    @Inject(AccountsRepository) private readonly repository: AccountsRepository,
  ) {}

  create(input: unknown): Promise<AccountIdentity> {
    return this.repository.create(
      parseAccountInput(createAccountSchema, input),
    );
  }

  // Trusted internal boundary only. The future controller must derive the ID from
  // its authenticated session, never from an editable request body or URL alone.
  rename(accountId: string, input: unknown): Promise<AccountIdentity> {
    if (!accountIdSchema.safeParse(accountId).success) {
      throw new AccountError(
        'INVALID_ACCOUNT_INPUT',
        'Invalid account identifier.',
        'accountId',
      );
    }
    const parsed = parseAccountInput(renameAccountSchema, input);
    return this.repository.rename(accountId, parsed.username);
  }
}
