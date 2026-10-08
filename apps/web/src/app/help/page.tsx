import Link from 'next/link';
import { Brand } from '@/components/auth/auth-frame';
import { HelpCenter } from '@/components/help/help-center';
export const metadata = {
  title: 'Help',
  description:
    'Answers about cash back, prize codes, paid tasks, your wallet and running campaigns on Acticlaim.',
  robots: { index: true, follow: true },
};
export default function Page() {
  return (
    <div className="help-page">
      <header className="help-bar">
        <Brand />
        <Link className="button button-outline" href="/login">
          Sign in
        </Link>
      </header>
      <main id="main-content" className="help-shell">
        <div className="help-intro">
          <h1>
            How can we <em className="lp-serif">help?</em>
          </h1>
          <p>
            Answers about earning, your wallet, running campaigns and keeping
            your account safe.
          </p>
        </div>
        <HelpCenter />
        <div className="help-links">
          <Link className="text-link" href="/verify-email">
            Resend confirmation
          </Link>
          <Link className="text-link" href="/forgot-password">
            Reset password
          </Link>
          <Link className="text-link" href="/terms">
            Terms
          </Link>
          <Link className="text-link" href="/privacy">
            Privacy
          </Link>
        </div>
      </main>
    </div>
  );
}
