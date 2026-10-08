import Link from 'next/link';
import { Mail } from 'lucide-react';
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
        <section className="help-contact" aria-labelledby="contact-heading">
          <span className="help-contact-icon" aria-hidden>
            <Mail size={22} />
          </span>
          <div>
            <h2 id="contact-heading">Still need help?</h2>
            <p>
              A person reads every message. Never send your password or a code.
            </p>
          </div>
          <a
            className="button button-primary"
            href="mailto:support@acticlaim.com"
          >
            support@acticlaim.com
          </a>
        </section>
      </main>
      <footer className="help-footer">
        © {new Date().getFullYear()} Acticlaim ·{' '}
        <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link>
      </footer>
    </div>
  );
}
