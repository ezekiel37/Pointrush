import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowUpRight, Check, MoveUpRight } from 'lucide-react';
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="PointRush home">
      <span className="brand-mark">
        <MoveUpRight aria-hidden size={22} />
      </span>
      PointRush<span className="brand-dot">.</span>
    </Link>
  );
}
export function AuthFrame({
  title,
  description,
  children,
  step = 0,
}: {
  title: string;
  description: string;
  children: ReactNode;
  step?: number;
}) {
  return (
    <div className="auth-layout">
      <aside className="auth-story">
        <Brand />
        <div className="story-body">
          <p className="eyebrow">A little effort. A new possibility.</p>
          <h2>
            Make your
            <br />
            next move
            <br />
            <span>count.</span>
          </h2>
          <p className="story-copy">
            A place for people and businesses to turn meaningful actions into
            opportunities.
          </p>
          <ol className="journey" aria-label="Account setup steps">
            {['Create your account', 'Verify your email', 'Make it yours'].map(
              (label, i) => (
                <li
                  key={label}
                  aria-current={step === i + 1 ? 'step' : undefined}
                >
                  <span>
                    {step > i + 1 ? <Check size={16} aria-hidden /> : i + 1}
                  </span>
                  {label}
                </li>
              ),
            )}
          </ol>
        </div>
        <p className="story-footer">
          Your progress, at your pace. <ArrowUpRight size={18} aria-hidden />
        </p>
      </aside>
      <div className="auth-main">
        <header className="mobile-brand">
          <Brand />
        </header>
        <main id="main-content" className="auth-content">
          <p className="eyebrow">Your PointRush account</p>
          <h1>{title}</h1>
          <p className="intro">{description}</p>
          {children}
        </main>
        <footer className="auth-footer">
          <span>Built for real progress.</span>
          <Link href="/help">Account help</Link>
        </footer>
      </div>
    </div>
  );
}
