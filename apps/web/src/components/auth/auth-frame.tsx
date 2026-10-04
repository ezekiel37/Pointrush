import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowUpRight, Check, TicketCheck } from 'lucide-react';
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Acticlaim home">
      <span className="brand-mark">
        <TicketCheck aria-hidden size={18} strokeWidth={2.25} />
      </span>
      Acticlaim
    </Link>
  );
}
export function AuthFrame({
  title,
  description,
  children,
  step = 0,
  journeyLabels = ['Create your account', 'Verify your email', 'Make it yours'],
  journeyLabel = 'Account setup steps',
}: {
  title: string;
  description: string;
  children: ReactNode;
  step?: number;
  journeyLabels?: string[];
  journeyLabel?: string;
}) {
  return (
    <div className="auth-layout">
      <aside className="auth-story">
        <Brand />
        <div className="story-body">
          <p className="eyebrow">Proof pays</p>
          <h2>
            Buy. Work.
            <br />
            Get paid
            <br />
            <span>back.</span>
          </h2>
          <p className="story-copy">
            Businesses lock the money before you act. Cash back for real
            purchases, prizes for real codes, pay for real work.
          </p>
          <ol className="journey" aria-label={journeyLabel}>
            {journeyLabels.map((label, i) => (
              <li
                key={label}
                aria-current={step === i + 1 ? 'step' : undefined}
              >
                <span>
                  {step > i + 1 ? <Check size={16} aria-hidden /> : i + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>
        </div>
        <p className="story-footer">
          Every naira is locked before it is promised.{' '}
          <ArrowUpRight size={18} aria-hidden />
        </p>
      </aside>
      <div className="auth-main">
        <header className="mobile-brand">
          <Brand />
        </header>
        <main id="main-content" className="auth-content">
          <p className="eyebrow">Your Acticlaim account</p>
          <h1>{title}</h1>
          <p className="intro">{description}</p>
          {children}
        </main>
        <footer className="auth-footer">
          <span>Money locked first. Paid once.</span>
          <Link href="/help">Account help</Link>
        </footer>
      </div>
    </div>
  );
}
