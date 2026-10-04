import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { SendEmailPayload } from './email-payload.js';

export class EmailDeliveryError extends Error {
  constructor(
    readonly retryable: boolean,
    readonly retryAfterSeconds = 60,
  ) {
    super('Authentication email delivery failed');
  }
}

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
      ? 'Verify your Acticlaim email'
      : 'Reset your Acticlaim password',
    text: `${verify ? 'Verify your email address' : 'Reset your password'} using this link:\n\n${message.url}\n\nIf you did not request this, ignore this email. Never share this link. Acticlaim will never ask for your password.`,
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
  const send = createResendPayloadSender(apiKey, transport);
  return async (message) =>
    send(
      {
        from: `Acticlaim <${from}>`,
        to: message.to,
        ...authEmailContent(message),
      },
      `auth-email/${randomUUID()}`,
    );
}

export function createResendPayloadSender(
  apiKey: string,
  transport: typeof fetch = fetch,
): SendEmailPayload {
  if (!apiKey.trim()) throw new Error('Resend API key is required');
  return async (payload, idempotencyKey, signal) => {
    const body = JSON.stringify(payload);
    let failure = new EmailDeliveryError(true);
    // The pinned SDK logs raw provider errors outside production and does not
    // expose AbortSignal in its send options. Use the documented endpoint here
    // to bound transport time and keep provider payloads out of logs.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw new EmailDeliveryError(true);
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
          signal: AbortSignal.any([
            AbortSignal.timeout(5000),
            ...(signal ? [signal] : []),
          ]),
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
          let concurrentRequest = false;
          if (response.status === 409) {
            const error: unknown = await response.json();
            concurrentRequest = Boolean(
              error &&
              typeof error === 'object' &&
              'name' in error &&
              error.name === 'concurrent_idempotent_requests',
            );
          }
          const retryAfter = response.headers.get('retry-after');
          const parsedDelay =
            retryAfter && /^\d+$/.test(retryAfter)
              ? Number(retryAfter)
              : retryAfter
                ? Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000)
                : 60;
          failure = new EmailDeliveryError(
            concurrentRequest ||
              response.status === 429 ||
              response.status >= 500,
            Number.isFinite(parsedDelay) ? Math.max(60, parsedDelay) : 60,
          );
          retry =
            response.status >= 500 && !response.headers.has('retry-after');
          if (!response.bodyUsed) await response.body?.cancel();
        }
      } catch {
        failure = new EmailDeliveryError(true);
        retry = true;
      }
      // Rate limits, explicit backoff, credentials and validation errors are not
      // retried inline. They require a new user request after the local cooldown.
      if (!retry || attempt === 1 || signal?.aborted) break;
      try {
        await delay(250, undefined, { signal });
      } catch {
        throw new EmailDeliveryError(true);
      }
    }
    throw failure;
  };
}
