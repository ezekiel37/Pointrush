import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { DatabaseService } from '../database/database.service.js';
import * as schema from '../database/schema.js';
import { AccountError, isUsernameConflict } from './account.error.js';

type AccountDatabase = {
  readonly db: PgDatabase<PgQueryResultHKT, typeof schema>;
};
const { accounts, accountProfiles, usernames } = schema;

export interface AccountIdentity {
  id: string;
  username: string;
  displayName: string;
}

@Injectable()
export class AccountsRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: AccountDatabase,
  ) {}

  async create(input: {
    username: string;
    displayName: string;
  }): Promise<AccountIdentity> {
    try {
      return await this.database.db.transaction(async (tx) => {
        const [account] = await tx
          .insert(accounts)
          .values({})
          .returning({ id: accounts.id });
        if (!account)
          throw new Error('Account insert did not return an identifier');
        await tx
          .insert(accountProfiles)
          .values({ accountId: account.id, displayName: input.displayName });
        await tx.insert(usernames).values({
          username: input.username,
          accountId: account.id,
          isCurrent: true,
        });
        return { id: account.id, ...input };
      });
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async rename(accountId: string, username: string): Promise<AccountIdentity> {
    try {
      return await this.database.db.transaction(async (tx) => {
        // Serialize identity edits for this account before checking current state or time.
        const [account] = await tx
          .select()
          .from(accounts)
          .where(eq(accounts.id, accountId))
          .for('update');
        if (!account)
          throw new AccountError('ACCOUNT_NOT_FOUND', 'Account was not found.');
        if (account.accessState !== 'active')
          throw new AccountError(
            'ACCOUNT_NOT_ACTIVE',
            'Account changes are currently unavailable.',
          );
        const [identity] = await tx
          .select({
            username: usernames.username,
            displayName: accountProfiles.displayName,
            canRename: sql<boolean>`${accountProfiles.usernameChangedAt} is null or ${accountProfiles.usernameChangedAt} + interval '720 hours' <= clock_timestamp()`,
            eligibleAt:
              sql<Date | null>`${accountProfiles.usernameChangedAt} + interval '720 hours'`.mapWith(
                accountProfiles.usernameChangedAt,
              ),
          })
          .from(accountProfiles)
          .innerJoin(
            usernames,
            and(
              eq(usernames.accountId, accountProfiles.accountId),
              eq(usernames.isCurrent, true),
            ),
          )
          .where(eq(accountProfiles.accountId, accountId));
        if (!identity) throw new Error('Account identity is incomplete');
        if (identity.username === username)
          return { id: accountId, username, displayName: identity.displayName };
        if (!identity.canRename)
          throw new AccountError(
            'USERNAME_CHANGE_TOO_SOON',
            'You can change your username once every 30 days.',
            'username',
            identity.eligibleAt ?? undefined,
          );
        await tx
          .update(usernames)
          .set({ isCurrent: false, retiredAt: sql`clock_timestamp()` })
          .where(
            and(
              eq(usernames.accountId, accountId),
              eq(usernames.isCurrent, true),
            ),
          );
        await tx.insert(usernames).values({
          username,
          accountId,
          isCurrent: true,
          claimedAt: sql`clock_timestamp()`,
        });
        await tx
          .update(accountProfiles)
          .set({ usernameChangedAt: sql`clock_timestamp()` })
          .where(eq(accountProfiles.accountId, accountId));
        return { id: accountId, username, displayName: identity.displayName };
      });
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  private rethrowConflict(error: unknown): never {
    if (isUsernameConflict(error)) {
      throw new AccountError(
        'USERNAME_UNAVAILABLE',
        'This username is unavailable.',
        'username',
      );
    }
    throw error;
  }
}
