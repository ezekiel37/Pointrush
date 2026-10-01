import { z } from 'zod';

export const emailEncryptionKey = z.string().regex(/^[0-9a-f]{64}$/i);

export function parseEnvironment<T>(
  schema: z.ZodType<T>,
  input: NodeJS.ProcessEnv,
): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.'));
    throw new Error(`Invalid environment configuration: ${fields.join(', ')}`);
  }
  return result.data;
}

export function assertTrustedOrigin(
  origin: string,
  field: string,
  production = false,
): void {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(
      `${field} requires an exact HTTPS origin (HTTP allowed only on non-production loopback)`,
    );
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    origin.includes('*') ||
    url.origin !== origin ||
    (url.protocol !== 'https:' &&
      !(local && !production && url.protocol === 'http:'))
  ) {
    throw new Error(
      `${field} requires an exact HTTPS origin (HTTP allowed only on non-production loopback)`,
    );
  }
}
