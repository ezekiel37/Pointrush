import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'Acticlaim', template: '%s | Acticlaim' },
  description: 'Your Acticlaim account.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NG">
      <body>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
