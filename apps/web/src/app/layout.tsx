import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './globals.css';
import { ServiceWorker } from '@/components/shell/service-worker';
export const metadata: Metadata = {
  title: { default: 'Acticlaim', template: '%s | Acticlaim' },
  description:
    'Cash back for real purchases and prizes for real codes. Businesses lock the money first.',
  applicationName: 'Acticlaim',
  appleWebApp: { capable: true, title: 'Acticlaim', statusBarStyle: 'default' },
  // Account and money pages are private; public pages opt in to indexing.
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f6f4' },
    { media: '(prefers-color-scheme: dark)', color: '#0c110f' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NG">
      <body>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
