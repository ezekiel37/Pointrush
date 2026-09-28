import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

export interface AuthEmail {
  kind: 'verify-email' | 'reset-password';
  to: string;
  url: string;
}

export type SendAuthEmail = (message: AuthEmail) => Promise<void>;

// A plain-text template avoids interpolating untrusted names into HTML.
export function authEmailContent(message: AuthEmail) {
  const verify = message.kind === 'verify-email';
  return {
    subject: verify
      ? 'Verify your PointRush email'
      : 'Reset your PointRush password',
    text: `${verify ? 'Verify your email address' : 'Reset your password'} using this link:\n\n${message.url}\n\nIf you did not request this, ignore this email. Never share this link. PointRush will never ask for your password.`,
  };
}

export function createResendAuthEmail(
  apiKey: string,
  from: string,
  transport: typeof fetch = fetch,
): SendAuthEmail {
  if (!apiKey.trim() || !z.email().safeParse(from).success) {
    throw new Error(
      'Auth email requires an API key and a valid sender address',
    );
  }
  return async (message) => {
    const body = JSON.stringify({
      from: `PointRush <${from}>`,
      to: message.to,
      ...authEmailContent(message),
    });
    const idempotencyKey = `auth-email/${randomUUID()}`;
    // The pinned SDK logs raw provider errors outside production and does not
    // expose AbortSignal in its send options. Use the documented endpoint here
    // to bound transport time and keep provider payloads out of logs.
    for (let attempt = 0; attempt < 2; attempt++) {
      let retry: boolean;
      try {
        const response = await transport('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body,
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          const data: unknown = await response.json();
          if (
            data &&
            typeof data === 'object' &&
            'id' in data &&
            typeof data.id === 'string' &&
            data.id
          )
            return;
          retry = true; // Ambiguous acceptance; reuse the exact payload and key.
        } else {
          retry =
            response.status >= 500 && !response.headers.has('retry-after');
          await response.body?.cancel();
        }
      } catch {
        retry = true;
      }
      // Rate limits, explicit backoff, credentials and validation errors are not
      // retried inline. They require a new user request after the local cooldown.
      if (!retry || attempt === 1) break;
      await delay(250);
    }
    throw new Error('Authentication email delivery failed');
  };
}
