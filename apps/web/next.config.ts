import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
const security = [
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
