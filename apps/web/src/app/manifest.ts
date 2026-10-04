import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Acticlaim',
    short_name: 'Acticlaim',
    description:
      'Cash back for real purchases, prize codes and paid work, backed by money businesses lock first.',
    id: '/',
    start_url: '/offers',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f3f0e8',
    theme_color: '#f3f0e8',
    categories: ['finance', 'shopping', 'business'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      { name: 'Claim a prize', url: '/claim' },
      { name: 'Wallet', url: '/wallet' },
    ],
  };
}
