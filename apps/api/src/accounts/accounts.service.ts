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

  assertAuthAccess(authUserId: string): Promise<void> {
    return this.repository.assertAuthAccess(authUserId);
  }

  getForAuth(authUserId: string) {
    return this.repository.getForAuth(authUserId);
  }

  create(input: unknown): Promise<AccountIdentity> {
    return this.repository.create(
      parseAccountInput(createAccountSchema, input),
    );
  }

  createForAuth(authUserId: string, input: unknown): Promise<AccountIdentity> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(authUserId)) {
      throw new AccountError(
        'INVALID_ACCOUNT_INPUT',
        'Invalid authenticated identity.',
      );
    }
    const parsed = parseAccountInput(createAccountSchema, input);
    return this.repository.createForAuth({ authUserId, ...parsed });
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
