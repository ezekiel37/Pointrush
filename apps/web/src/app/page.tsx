import Link from 'next/link';
import type { Metadata } from 'next';
import { BriefcaseBusiness, Lock, ScanLine, TicketCheck } from 'lucide-react';
import { Brand } from '@/components/auth/auth-frame';

export const metadata: Metadata = {
  title: { absolute: 'Acticlaim: cash back, prize codes and paid work' },
  description:
    'Get money back when you buy, claim prizes you scratch and get paid for work. Businesses lock every naira before it is promised.',
  robots: { index: true, follow: true },
};

const ways = [
  {
    icon: ScanLine,
    title: 'Cash back when you buy',
    body: 'Get a code, show it at the till, and the business confirms your purchase. Cash back unlocks after the refund window.',
  },
  {
    icon: TicketCheck,
    title: 'Prizes you can trust',
    body: 'Scratched a winning code from a promotion? Claim it here. The prize money was locked before the papers were printed.',
  },
  {
    icon: BriefcaseBusiness,
    title: 'Paid work with proof',
    body: 'Do work for businesses with the pay locked in advance. Every paid job adds to a record nobody can fake.',
  },
];

export default function Home() {
  return (
    <>
      <header className="app-bar">
        <Brand />
        <nav className="flex items-center gap-2" aria-label="Account">
          <Link className="button button-ghost hide-narrow" href="/login">
            Sign in
          </Link>
          <Link className="button button-primary" href="/signup">
            Get started
          </Link>
        </nav>
      </header>
      <main id="main-content" className="app-main" style={{ paddingBottom: 0 }}>
        <section
          className="hero"
          style={{
            gridTemplateColumns:
              'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
            alignItems: 'center',
          }}
        >
          <div className="grid gap-5">
            <p className="eyebrow">Proof pays</p>
            <h1>
              Get paid <mark>back</mark> for what you already do.
            </h1>
            <p>
              Cash back when you buy. Prizes when you scratch. Pay when you
              work. Every naira is locked by the business before it is promised
              to you.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link className="button button-accent" href="/offers">
                Find offers
              </Link>
              <Link className="button button-outline" href="/claim">
                Claim a prize
              </Link>
            </div>
          </div>
          <figure style={{ margin: 0 }}>
            <div className="ticket" aria-hidden>
              <div className="ticket-head">
                <p className="eyebrow">Mama Put Kitchen · Ibadan</p>
                <h2>Lunch cash back</h2>
              </div>
              <div className="ticket-body">
                <span className="amount amount-xl">₦500</span>
                <p className="small-note">back on meals from ₦3,000</p>
              </div>
              <div className="ticket-perforation" />
              <div className="ticket-body">
                <span className="ticket-code">7K4M2-PRDH9</span>
                <div className="countdown">
                  <div className="countdown-track">
                    <div
                      className="countdown-fill"
                      style={{ transform: 'scaleX(0.72)' }}
                    />
                  </div>
                  <p className="small-note">Valid for 10:48 more</p>
                </div>
              </div>
            </div>
            <figcaption
              className="small-note"
              style={{ textAlign: 'center', marginTop: '0.75rem' }}
            >
              Example ticket. Each code works once, for one person, for 15
              minutes.
            </figcaption>
          </figure>
        </section>

        <section aria-labelledby="how-heading" style={{ marginTop: '1rem' }}>
          <h2 id="how-heading" className="eyebrow">
            How it works
          </h2>
          <ol className="steps">
            <li>
              <h3>A business locks the money</h3>
              <p className="small-note">
                Before an offer, promotion or job goes live, the full amount is
                set aside and checked by our reviewers.
              </p>
            </li>
            <li>
              <h3>You buy, scratch or work</h3>
              <p className="small-note">
                Show your code at the till, enter a winning code, or deliver the
                work you agreed to.
              </p>
            </li>
            <li>
              <h3>Verified once, paid once</h3>
              <p className="small-note">
                Each purchase, code and job is confirmed a single time, then the
                money moves to your wallet.
              </p>
            </li>
          </ol>
        </section>

        <ul className="grid-cards" style={{ marginTop: '3rem' }}>
          {ways.map(({ icon: Icon, title, body }) => (
            <li key={title} className="card grid gap-2">
              <Icon size={26} aria-hidden />
              <h3 style={{ margin: 0 }}>{title}</h3>
              <p className="small-note">{body}</p>
            </li>
          ))}
        </ul>

        <section className="band grid gap-4" aria-labelledby="business-heading">
          <p className="eyebrow" style={{ color: 'var(--color-accent)' }}>
            For businesses
          </p>
          <h2
            id="business-heading"
            style={{ fontSize: 'clamp(1.8rem, 5vw, 2.8rem)', maxWidth: '18ch' }}
          >
            Pay for customers who actually came, not for views.
          </h2>
          <p style={{ maxWidth: '58ch' }}>
            Fund cash back for real purchases, run scratch-and-win with codes we
            verify, or hire people with pay held safely. See who bought, who
            claimed and who came back.
          </p>
          <div>
            <Link className="button button-accent" href="/business">
              Run a campaign
            </Link>
          </div>
        </section>

        <section aria-labelledby="promise-heading" className="grid gap-3">
          <h2 id="promise-heading" className="icon-line">
            <Lock size={22} aria-hidden /> What we promise
          </h2>
          <ul className="stack small-note" style={{ maxWidth: '62ch' }}>
            <li>No betting, no guaranteed income, no pay-to-earn schemes.</li>
            <li>Points are not cash, and we never call them cash.</li>
            <li>Your public record never shows where you shop.</li>
            <li>
              Chance-based promotions run only with the business&apos;s state
              permit, checked before launch.
            </li>
          </ul>
        </section>
      </main>
      <footer className="site-footer">
        <span>© Acticlaim</span>
        <Link href="/help">Help</Link>
        <Link href="/login">Sign in</Link>
        <Link href="/business">For businesses</Link>
      </footer>
    </>
  );
}
