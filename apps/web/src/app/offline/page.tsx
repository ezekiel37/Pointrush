import Link from 'next/link';
import { WifiOff } from 'lucide-react';
import { Brand } from '@/components/auth/auth-frame';
export const metadata = { title: 'Offline' };
// Precached by the service worker and shown when a page is unavailable offline.
export default function Page() {
  return (
    <main id="main-content" className="standalone grid gap-4">
      <Brand />
      <WifiOff size={32} aria-hidden />
      <h1>You are offline</h1>
      <p className="small-note">
        Purchase codes you already opened still work: go back to the offer to
        show it at the till. Claims, balances and confirmations need a
        connection, so nothing is lost or sent twice while you are offline.
      </p>
      <Link className="button button-primary" href="/offers">
        Try again
      </Link>
    </main>
  );
}
