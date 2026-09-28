import { Resend } from 'resend';
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
): SendAuthEmail {
  if (!apiKey.trim() || !z.email().safeParse(from).success) {
    throw new Error(
      'Auth email requires an API key and a valid sender address',
    );
  }
  const resend = new Resend(apiKey);
  return async (message) => {
    try {
      const result = await resend.emails.send({
        from: `PointRush <${from}>`,
        to: message.to,
        ...authEmailContent(message),
      });
      if (result.error || !result.data?.id) throw new Error('Delivery failed');
    } catch {
      // Do not propagate provider payloads, recipient addresses or token URLs.
      throw new Error('Authentication email delivery failed');
    }
  };
}
