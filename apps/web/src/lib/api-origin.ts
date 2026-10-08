const loopback = ['localhost', '127.0.0.1', '[::1]'];
// The API address. Usually fixed into the site when it is built. Hosts that
// only provide settings at runtime still work: the server reads the setting
// when it runs, and the browser uses the convention that the API lives at
// api.<site>, for example api.acticlaim.com for acticlaim.com.
function configuredOrigin(): string | undefined {
  const built = process.env.NEXT_PUBLIC_API_ORIGIN;
  if (built) return built;
  if (typeof window === 'undefined')
    return (process.env as Record<string, string | undefined>)[
      'NEXT_PUBLIC_API_ORIGIN'
    ];
  const host = window.location.hostname.replace(/^www\./, '');
  return loopback.includes(host) ? undefined : `https://api.${host}`;
}
export function apiOrigin(): string {
  const value = configuredOrigin();
  if (!value) throw new Error('API configuration unavailable');
  const url = new URL(value);
  const local = loopback.includes(url.hostname);
  if (
    url.origin !== value ||
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
  )
    throw new Error('Invalid API configuration');
  return value;
}
