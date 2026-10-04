import { randomUUID } from 'node:crypto';
import {
  getCurrentAdapter,
  getCurrentAuthEndpointContext,
} from '@better-auth/core/context';
import { z } from 'zod';
import { APIError } from 'better-auth/api';
import { authEmailContent } from './auth.email.js';
import type { SendAuthEmail } from './auth.email.js';
import { EmailPayloadCipher } from './email-payload.js';

export function createQueuedAuthEmail(
  key: string,
  sender: string,
): SendAuthEmail {
  const cipher = new EmailPayloadCipher(key);
  if (!z.email().safeParse(sender).success)
    throw new Error('Invalid auth email sender');
  return async (message) => {
    const context = getCurrentAuthEndpointContext();
    const adapter = await getCurrentAdapter(context.context.adapter);
    const id = randomUUID();
    const now = new Date();
    // The queue lifetime is shorter than both reset (30m) and verify (60m) links.
    const expiresAt = new Date(now.getTime() + 20 * 60 * 1000);
    try {
      await adapter.create({
        model: 'authEmailJob',
        forceAllowId: true,
        data: {
          id,
          state: 'pending',
          attempts: 0,
          createdAt: now,
          availableAt: now,
          expiresAt,
          payload: cipher.seal(id, {
            from: `Acticlaim <${sender}>`,
            to: message.to,
            ...authEmailContent(message),
          }),
        },
      });
    } catch {
      // Typed errors avoid the HTTP library's raw unexpected-error logging.
      throw new APIError('SERVICE_UNAVAILABLE', {
        message: 'Email requests are temporarily unavailable',
      });
    }
  };
}
