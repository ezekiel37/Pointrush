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
const config: NextConfig = {
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
