import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import './globals.css';
import { ServiceWorker } from '@/components/shell/service-worker';
export const metadata: Metadata = {
  title: { default: 'Acticlaim', template: '%s | Acticlaim' },
  description:
    'Cash back for real purchases, prizes for real codes and pay for real work. Businesses lock the money first.',
  applicationName: 'Acticlaim',
  appleWebApp: { capable: true, title: 'Acticlaim', statusBarStyle: 'default' },
  // Account and money pages are private; public pages opt in to indexing.
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  themeColor: '#f3f0e8',
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
