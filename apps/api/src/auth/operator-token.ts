import { createHash, timingSafeEqual } from 'node:crypto';

export function hashOperatorToken(token: string): string {
  if (!token || token.length < 32)
    throw new Error('Operator token is too short');
  return createHash('sha256').update(token).digest('hex');
}

export function authorizeOperatorToken(
  tokenHash: string,
  presentedToken: string,
): void {
  if (!/^[a-f0-9]{64}$/.test(tokenHash))
    throw new Error('Operator token hash is invalid');
  const expected = Buffer.from(tokenHash, 'hex');
  const actual = createHash('sha256').update(presentedToken).digest();
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new Error('Operator authorization failed');
}
