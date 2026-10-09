import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
// Where the browser may send data: this site and the API. Anything injected
// into a page cannot send stolen data elsewhere or load outside scripts.
const apiOrigins = [
  'https://api.acticlaim.com',
  process.env.NEXT_PUBLIC_API_ORIGIN,
].filter(Boolean);
const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js inlines its startup scripts; outside scripts are never allowed.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // Logos, profile pictures and evidence are served by the API.
  `img-src 'self' data: blob: ${apiOrigins.join(' ')}`,
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigins.join(' ')}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');
// The development server needs eval and a websocket; the policy applies to
// production builds.
const production = process.env.NODE_ENV === 'production';
const security = [
  ...(production
    ? [
        { key: 'Content-Security-Policy', value: contentSecurityPolicy },
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains',
        },
      ]
    : []),
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    // Camera is allowed for this origin only: tills scan shoppers' QR codes.
    value: 'camera=(self), microphone=(), geolocation=()',
  },
];
// The website Docker image (apps/web/Dockerfile) builds a self-contained
// server. The repository root is traced so the shared contracts package is
// included.
const standalone = process.env.NEXT_OUTPUT === 'standalone';
const config: NextConfig = {
  ...(standalone
    ? {
        output: 'standalone' as const,
        outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
      }
    : {}),
  poweredByHeader: false,
  transpilePackages: ['@pointrush/contracts'],
  async headers() {
    return [
      { source: '/:path*', headers: security },
      {
        // Pages are never stored by browsers or proxies. Hashed static assets
        // and icons keep their long-lived caching for slow mobile data.
        source: '/((?!_next/static|icons/).*)',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8',
          },
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
        ],
      },
    ];
  },
};
export default config;
