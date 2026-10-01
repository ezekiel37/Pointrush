import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const emailPayloadSchema = z
  .object({
    from: z.string().min(1).max(320),
    to: z.email(),
    subject: z.string().min(1).max(200),
    text: z.string().min(1).max(16000),
  })
  .strict();
export type EmailPayload = z.infer<typeof emailPayloadSchema>;
export type SendEmailPayload = (
  payload: EmailPayload,
  idempotencyKey: string,
  signal?: AbortSignal,
) => Promise<void>;

export class EmailPayloadCipher {
  private readonly key: Buffer;
  constructor(hexKey: string) {
    if (!/^[0-9a-f]{64}$/i.test(hexKey))
      throw new Error('Email encryption requires a 32-byte hex key');
    this.key = Buffer.from(hexKey, 'hex');
  }

  seal(id: string, payload: EmailPayload): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(`pointrush-email:v1:${id}`));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(emailPayloadSchema.parse(payload)), 'utf8'),
      cipher.final(),
    ]);
    return [
      'v1',
      nonce.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  open(id: string, value: string): EmailPayload {
    try {
      const [version, nonce, tag, ciphertext, extra] = value.split('.');
      if (
        version !== 'v1' ||
        !nonce ||
        !tag ||
        !ciphertext ||
        extra !== undefined
      )
        throw new Error();
      if (
        Buffer.from(nonce, 'base64url').length !== 12 ||
        Buffer.from(tag, 'base64url').length !== 16
      )
        throw new Error();
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(nonce, 'base64url'),
      );
      decipher.setAAD(Buffer.from(`pointrush-email:v1:${id}`));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]);
      return emailPayloadSchema.parse(JSON.parse(plaintext.toString('utf8')));
    } catch {
      throw new Error('Email payload cannot be decrypted');
    }
  }
}
