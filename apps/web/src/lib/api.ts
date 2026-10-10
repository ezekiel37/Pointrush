import { z } from 'zod';
import { apiOrigin, RequestError } from './auth-client';

export const money = z.string().regex(/^\d+$/);
const conflict = z.object({ reason: z.string() }).partial();

// Cookie-authenticated API call. Failures carry the status and, for conflicts,
// the API's stable machine-readable reason.
export async function apiRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  options: {
    method?: 'GET' | 'POST';
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(15000);
  const response = await fetch(`${apiOrigin()}/api/v1/${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    cache: 'no-store',
    ...(options.body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options.body),
        }),
    signal: options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout,
  });
  if (!response.ok) {
    const detail = conflict.safeParse(await response.json().catch(() => null));
    throw new RequestError(
      response.status,
      detail.success ? detail.data.reason : undefined,
    );
  }
  return schema.parse(await response.json());
}

// Exact kobo arithmetic with bigint; money is never a floating-point number.
export function naira(kobo: string, { showKobo = false } = {}) {
  const amount = BigInt(kobo);
  const whole = (amount / 100n).toLocaleString('en-NG');
  const rest = amount % 100n;
  return showKobo || rest !== 0n
    ? `₦${whole}.${rest.toString().padStart(2, '0')}`
    : `₦${whole}`;
}

// Groups thousands as naira is typed, so "100000" reads "100,000". Keeps up
// to two decimals; toKobo reads the result back.
export function typedNaira(input: string) {
  const [whole = '', ...rest] = input.replace(/[^\d.]/g, '').split('.');
  const digits = whole.replace(/^0+(?=\d)/, '').slice(0, 12);
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return rest.length ? `${grouped}.${rest.join('').slice(0, 2)}` : grouped;
}

// "1,250.50" or "1250" naira typed at a till, to exact kobo. Null if invalid.
export function toKobo(input: string): string | null {
  const value = input.replace(/[\s,₦]/g, '');
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const kobo =
    BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  return kobo > 0n ? kobo.toString() : null;
}

export function shortDate(value: string) {
  return new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Africa/Lagos',
  }).format(new Date(value));
}

export function newId() {
  return crypto.randomUUID();
}
