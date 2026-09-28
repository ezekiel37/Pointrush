export type AccountErrorCode =
  | 'AUTH_IDENTITY_UNVERIFIED'
  | 'ACCOUNT_ALREADY_EXISTS'
  | 'INVALID_ACCOUNT_INPUT'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_NOT_ACTIVE'
  | 'USERNAME_UNAVAILABLE'
  | 'USERNAME_CHANGE_TOO_SOON';

export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    message: string,
    readonly field?: 'username' | 'displayName' | 'accountId',
    readonly eligibleAt?: Date,
  ) {
    super(message);
    this.name = 'AccountError';
  }
}

// Drizzle wraps driver errors. Never send its SQL, parameters or raw messages to callers.
export function isUsernameConflict(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (
      'code' in current &&
      current.code === '23505' &&
      'constraint' in current &&
      current.constraint === 'usernames_pkey'
    )
      return true;
    current = current.cause;
  }
  return false;
}
