import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ArrowRight,
  BadgeCheck,
  CupSoda,
  GraduationCap,
  Lock,
  Scissors,
  ScanLine,
  Store,
  TicketCheck,
  UtensilsCrossed,
} from 'lucide-react';
import { Brand } from '@/components/auth/auth-frame';
import { Spiral } from '@/components/landing/spiral';

export const metadata: Metadata = {
  title: { absolute: 'Acticlaim: cash back, prize codes and paid work' },
  description:
    'Get money back when you buy, claim prizes you scratch and get paid for work. Businesses lock every naira before it is promised.',
  robots: { index: true, follow: true },
};

// Decorative example curve for illustrations only; never presented as data.
function ExampleCurve({ height = 70 }: { height?: number }) {
  return (
    <svg
      viewBox="0 0 200 70"
      height={height}
      width="100%"
      aria-hidden
      preserveAspectRatio="none"
    >
      <path
        d="M0 58 C20 54 30 40 50 42 S80 30 100 34 S130 16 150 20 S180 8 200 6 L200 70 L0 70Z"
        fill="#0f6e50"
        fillOpacity="0.1"
      />
      <path
        d="M0 58 C20 54 30 40 50 42 S80 30 100 34 S130 16 150 20 S180 8 200 6"
        fill="none"
        stroke="#0f6e50"
        strokeWidth="2"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

const sectors = [
  { icon: UtensilsCrossed, label: 'Restaurants' },
  { icon: Scissors, label: 'Barbers & salons' },
  { icon: Store, label: 'Kiosks & shops' },
  { icon: CupSoda, label: 'Drinks brands' },
  { icon: GraduationCap, label: 'Campus businesses' },
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
        <section className="lp-hero" aria-labelledby="hero-heading">
          <Link
            className="lp-pill"
            href="/claim"
            style={{ textDecoration: 'none' }}
          >
            <b>New</b> Claim prize codes from scratch-and-win
            <ArrowRight size={14} aria-hidden />
          </Link>
          <h1 id="hero-heading">Get paid back for what you already do.</h1>
          <p>
            Cash back when you buy. Prizes when you scratch. Pay when you work.
            Every naira is locked by the business before it is promised to you.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link className="button button-primary" href="/offers">
              Find offers
            </Link>
            <Link className="button button-outline" href="/claim">
              Claim a prize
            </Link>
          </div>
        </section>

        <div className="lp-stage" aria-label="Example activity">
          <div className="lp-orbit" aria-hidden />
          <div className="lp-orbit lp-orbit-2" aria-hidden />
          <Spiral className="lp-spiral" />
          <div className="float float-a">
            <span className="small-note">Cash back · Mama Put</span>
            <strong>₦500</strong>
            <span className="chip chip-pending">Held 3 days</span>
          </div>
          <div className="float float-b">
            <span className="small-note">Prize claimed</span>
            <strong>₦5,000</strong>
            <span className="chip chip-done">Paid</span>
          </div>
          <div className="float float-c">
            <span className="small-note">In your wallet</span>
            <strong>₦7,200</strong>
          </div>
          <div className="float float-d" style={{ width: 170 }}>
            <span className="small-note">Shoppers who came back</span>
            <strong>+9</strong>
            <ExampleCurve height={36} />
          </div>
        </div>

        <div className="lp-strip" aria-label="Built for">
          <span className="small-note">Built for</span>
          {sectors.map(({ icon: Icon, label }) => (
            <span key={label}>
              <Icon size={18} aria-hidden /> {label}
            </span>
          ))}
        </div>

        <section className="lp-section" aria-labelledby="earn-heading">
          <div className="lp-split">
            <div>
              <p className="eyebrow">Three ways to earn</p>
              <h2 id="earn-heading">Real money for real activity.</h2>
            </div>
            <p>
              No tapping, no betting, no follow-for-follow. The business locks
              the money first; you earn once it confirms something real
              happened: a purchase, a winning code or finished work.
            </p>
          </div>
          <ul className="features">
            <li className="card">
              <div className="feature-visual" aria-hidden>
                <div
                  className="float"
                  style={{
                    position: 'static',
                    animation: 'none',
                    transform: 'rotate(-3deg)',
                    textAlign: 'center',
                  }}
                >
                  <span className="small-note">Show at the till</span>
                  <strong
                    className="num"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    7K4M2-PRDH9
                  </strong>
                  <div className="countdown-track" style={{ marginTop: 8 }}>
                    <div
                      className="countdown-fill"
                      style={{ transform: 'scaleX(0.7)' }}
                    />
                  </div>
                </div>
              </div>
              <div
                className="icon-line"
                style={{ gap: '0.6rem', marginBottom: '0.5rem' }}
              >
                <ScanLine size={20} aria-hidden />
                <h3 style={{ margin: 0 }}>Cash back when you buy</h3>
              </div>
              <p className="small-note">
                Get a code, show it at the till, and the business confirms the
                purchase. It unlocks after the refund window.
              </p>
            </li>
            <li className="card">
              <div className="feature-visual" aria-hidden>
                <div
                  style={{
                    width: 190,
                    padding: '1rem',
                    borderRadius: 14,
                    background: 'linear-gradient(135deg,#1baf7a,#0f6e50)',
                    color: '#fff',
                    boxShadow: 'var(--shadow-float)',
                    transform: 'rotate(3deg)',
                  }}
                >
                  <span style={{ fontSize: 12, opacity: 0.85 }}>
                    Scratch &amp; win
                  </span>
                  <div
                    style={{
                      marginTop: 10,
                      padding: '0.5rem',
                      borderRadius: 8,
                      background:
                        'linear-gradient(90deg,#d4f25a 0 55%, #c9ccc9 55%)',
                      color: '#0e1512',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    AC-7K4M-9X…
                  </div>
                </div>
              </div>
              <div
                className="icon-line"
                style={{ gap: '0.6rem', marginBottom: '0.5rem' }}
              >
                <TicketCheck size={20} aria-hidden />
                <h3 style={{ margin: 0 }}>Prizes you can trust</h3>
              </div>
              <p className="small-note">
                Scratched a winning code? Claim it here. The prize money was
                locked before the papers were printed.
              </p>
            </li>
            <li className="card">
              <div className="feature-visual" aria-hidden>
                <div
                  className="float"
                  style={{ position: 'static', animation: 'none', width: 200 }}
                >
                  <div className="row">
                    <strong style={{ fontSize: '0.95rem' }}>Tolu A.</strong>
                    <span className="chip chip-tier">Bronze</span>
                  </div>
                  <span className="small-note">
                    6 paid jobs · 2 repeat clients
                  </span>
                  <span className="badge" style={{ marginTop: 8 }}>
                    <BadgeCheck size={13} /> Verified record
                  </span>
                </div>
              </div>
              <div
                className="icon-line"
                style={{ gap: '0.6rem', marginBottom: '0.5rem' }}
              >
                <BadgeCheck size={20} aria-hidden />
                <h3 style={{ margin: 0 }}>Paid work with proof</h3>
              </div>
              <p className="small-note">
                Work for businesses with the pay locked in advance. Every paid
                job adds to a record nobody can fake.
              </p>
            </li>
          </ul>
        </section>

        <section className="lp-section" aria-labelledby="business-heading">
          <div className="lp-split">
            <div>
              <p className="eyebrow">For businesses</p>
              <h2 id="business-heading">
                Pay for customers who actually came.
              </h2>
            </div>
            <p>
              Not for views or follows. Fund cash back for confirmed purchases,
              run scratch-and-win with codes we verify, and hire with pay held
              safely.
            </p>
          </div>
          <div className="bento">
            <article className="card wide">
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div className="card-head">
                  <h3 style={{ margin: 0 }}>
                    See who bought and who came back
                  </h3>
                  <p>Confirmed purchases, by day</p>
                </div>
                <span className="chip chip-muted">Example</span>
              </div>
              <ExampleCurve height={120} />
            </article>
            <article className="card card-dark narrow grid gap-2">
              <Lock size={22} aria-hidden />
              <p className="eyebrow" style={{ margin: 0 }}>
                Backed
              </p>
              <h3 style={{ fontSize: '1.4rem', margin: 0 }}>
                Every naira is locked before launch.
              </h3>
              <p className="small-note">
                Customers trust offers they know are funded.
              </p>
            </article>
          </div>
        </section>

        <section className="band" aria-labelledby="cta-heading">
          <div className="grid gap-4" style={{ position: 'relative' }}>
            <h2 id="cta-heading" style={{ margin: 0 }}>
              Run your first campaign.
            </h2>
            <p style={{ margin: 0, maxWidth: '46ch' }}>
              Cash back, scratch-and-win or paid work. You fund it, we verify
              every claim, and you see the results.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link className="button button-accent" href="/business">
                For businesses
              </Link>
              <Link className="button button-outline" href="/help">
                How it works
              </Link>
            </div>
          </div>
          <div className="band-cards" aria-hidden>
            <div className="money-card money-card-lime">
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                Prize pool · locked
              </span>
              <strong>₦50,000</strong>
              <span style={{ fontSize: 12 }}>10 prizes of ₦5,000</span>
            </div>
            <div className="money-card money-card-green">
              <span style={{ fontSize: 13, opacity: 0.85 }}>
                Cash back · locked
              </span>
              <strong>₦50,000</strong>
              <span style={{ fontSize: 12, opacity: 0.85 }}>
                100 buyers × ₦500
              </span>
            </div>
          </div>
        </section>

        <section
          className="lp-section"
          aria-labelledby="promise-heading"
          style={{ paddingBottom: '3rem' }}
        >
          <div className="lp-center">
            <p className="eyebrow">What we promise</p>
            <h2 id="promise-heading">Honest by design.</h2>
          </div>
          <ul className="features promise-grid">
            <li className="card small-note">
              No betting, no guaranteed income, no pay-to-earn schemes.
            </li>
            <li className="card small-note">
              Points are not cash, and we never call them cash.
            </li>
            <li className="card small-note">
              Your public record never shows where you shop.
            </li>
            <li className="card small-note">
              Chance-based promotions run only with the business&apos;s state
              permit, checked before launch.
            </li>
          </ul>
        </section>
      </main>
      <footer className="site-footer">
        <div className="card grid gap-3">
          <h2 style={{ margin: 0 }}>Start with Acticlaim</h2>
          <p className="small-note">Free for shoppers and workers.</p>
          <div>
            <Link className="button button-primary" href="/signup">
              Create account
            </Link>
          </div>
        </div>
        <div className="card">
          <p className="eyebrow">Earn</p>
          <nav aria-label="Earn">
            <Link href="/offers">Offers</Link>
            <Link href="/claim">Prize codes</Link>
            <Link href="/tasks">Jobs</Link>
          </nav>
        </div>
        <div className="card">
          <p className="eyebrow">Acticlaim</p>
          <nav aria-label="Acticlaim">
            <Link href="/business">For businesses</Link>
            <Link href="/help">Help</Link>
            <Link href="/login">Sign in</Link>
          </nav>
          <p className="small-note" style={{ marginTop: '1rem' }}>
            © Acticlaim
          </p>
        </div>
      </footer>
    </>
  );
}
