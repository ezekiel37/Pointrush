import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './globals.css';
import { ServiceWorker } from '@/components/shell/service-worker';
import { Toaster } from '@/components/ui/toast';
import { siteOrigin } from '@/lib/site';
export const metadata: Metadata = {
  title: { default: 'Acticlaim', template: '%s | Acticlaim' },
  description:
    'Cash back for real purchases and prizes for real codes. Businesses lock the money first.',
  applicationName: 'Acticlaim',
  // Absolute links for shared-link previews (WhatsApp, X, Facebook).
  metadataBase: new URL(siteOrigin()),
  openGraph: {
    siteName: 'Acticlaim',
    type: 'website',
    locale: 'en_NG',
    title: 'Acticlaim',
    description:
      'Cash back for real purchases and prizes for real codes. Businesses lock the money first.',
  },
  twitter: { card: 'summary_large_image' },
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
        <Toaster />
        <ServiceWorker />
      </body>
    </html>
  );
}
