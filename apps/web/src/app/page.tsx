import Link from 'next/link';
import type { Metadata } from 'next';
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import {
  ArrowDown,
  ArrowDownRight,
  ArrowRight,
  BadgeCheck,
  Code2,
  CupSoda,
  GraduationCap,
  Lock,
  Pill,
  Rocket,
  Scissors,
  ScanLine,
  Shirt,
  Store,
  TicketCheck,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react';
import { Brand } from '@/components/auth/auth-frame';
import { EmailCapture } from '@/components/landing/email-capture';
import { SocialLinks } from '@/components/landing/social-links';
import { jobsEnabled } from '@/lib/features';

export const metadata: Metadata = {
  title: { absolute: 'Acticlaim: cash back, prize codes and paid tasks' },
  description:
    'Get money back when you buy, claim prize codes where every code wins, and get paid for tasks. Businesses lock every naira before it is promised.',
  robots: { index: true, follow: true },
};

const sectors = [
  { icon: UtensilsCrossed, label: 'Restaurants' },
  { icon: Scissors, label: 'Salons & barbers' },
  { icon: Store, label: 'Supermarkets' },
  { icon: Pill, label: 'Pharmacies' },
  { icon: Shirt, label: 'Fashion' },
  { icon: CupSoda, label: 'Drinks & FMCG brands' },
  { icon: GraduationCap, label: 'Campus businesses' },
  ...(jobsEnabled ? [{ icon: Rocket, label: 'Startups & apps' }] : []),
];

const audiences = [
  {
    icon: Store,
    who: 'Shops, restaurants & salons',
    title: 'Turn first visits into regulars.',
    body: 'Offer cash back on real purchases. Your staff confirm each sale at the till, so you only pay for customers who actually bought.',
    cta: 'Start a cash back offer',
  },
  {
    icon: TicketCheck,
    who: 'Brands',
    title: 'Every pack can win.',
    body: 'Print prize codes on packs, cards or receipts. You fund the prizes upfront, every code wins, and we check every claim.',
    cta: 'Create prize codes',
  },
  ...(jobsEnabled
    ? [
        {
          icon: Code2,
          who: 'Startups & software companies',
          title: 'Real people, real feedback.',
          body: 'Pay people to test your app, try your product or finish a task. The pay is locked first, and you only pay for approved work.',
          cta: 'Post a paid task',
        },
      ]
    : []),
];

export default function Home() {
  return (
    <>
      <header className="app-bar">
        <Brand />
        <nav className="lp-nav hide-narrow" aria-label="Main">
          <a href="#earn">How you earn</a>
          <a href="#businesses">For businesses</a>
          <Link href="/help">Help</Link>
        </nav>
        <nav className="flex items-center gap-2" aria-label="Account">
          <Link className="button button-outline hide-narrow" href="/login">
            Sign in
          </Link>
          <Link className="button button-primary" href="/signup">
            Get started
          </Link>
        </nav>
      </header>
      <main
        id="main-content"
        className="app-main lp-main"
        style={{ paddingBottom: 0 }}
      >
        <section className="lp-hero3" aria-labelledby="hero-heading">
          <div className="lp-hero3-copy">
            <p className="lp-kicker">
              Free to join. <b>Paid to your bank.</b>
            </p>
            <h1 id="hero-heading">
              <span className="lp-h-light">Get paid back</span>
              <span className="lp-h-bold">for what you</span>
              <span className="lp-h-serif">already do.</span>
            </h1>
            <p>
              Cash back when you buy, prize codes where every code wins
              {jobsEnabled ? ', and paid tasks from real businesses' : ''}.
              Businesses pay the reward in before the offer goes live, so it is
              there when you earn it.
            </p>
            <div className="lp-actions">
              <Link className="button button-primary lp-cta" href="/signup">
                Start earning
              </Link>
              <a className="lp-demo" href="#earn">
                <span aria-hidden>
                  <ArrowDown size={14} />
                </span>
                See how it works
              </a>
            </div>
            <p className="lp-claim-link">
              Found a code on a pack or card?{' '}
              <Link href="/claim">Claim a prize code</Link>
            </p>
            <dl className="lp-stats">
              <div>
                <dt>To join</dt>
                <dd>₦0</dd>
              </div>
              <div>
                <dt>Prize codes that win</dt>
                <dd>Every one</dd>
              </div>
              <div>
                <dt>Rewards paid in before launch</dt>
                <dd>Prepaid</dd>
              </div>
            </dl>
          </div>

          <div
            className="lp-visual"
            role="img"
            aria-label="Example of the Acticlaim app: a wallet with cash back, a prize and a paid task"
          >
            <div className="lp-arc" aria-hidden />
            <svg className="lp-burst" viewBox="0 0 100 100" aria-hidden>
              {Array.from({ length: 36 }, (_, i) => (
                <line
                  key={i}
                  x1="50"
                  y1="50"
                  x2={50 + 48 * Math.cos((i * Math.PI) / 18)}
                  y2={50 + 48 * Math.sin((i * Math.PI) / 18)}
                />
              ))}
            </svg>
            <svg
              className="lp-wires"
              viewBox="0 0 400 420"
              preserveAspectRatio="none"
              aria-hidden
            >
              <path d="M70 120 C 110 120, 110 170, 150 170" />
              <path d="M330 300 C 290 300, 290 250, 250 250" />
              <path d="M60 330 C 100 330, 120 300, 150 300" />
            </svg>

            <div className="lp-phone" aria-hidden>
              <div className="lp-phone-notch" />
              <div className="lp-phone-screen">
                <span className="lp-phone-hello">Good evening, Tolu</span>
                <div className="lp-phone-balance">
                  <span>Wallet</span>
                  <strong>₦7,200</strong>
                  <span className="lp-phone-pill">Withdraw</span>
                </div>
                <span className="lp-phone-label">Recent</span>
                <ul className="lp-phone-list">
                  <li>
                    <span className="lp-ico lp-ico-green">
                      <ScanLine size={14} />
                    </span>
                    <span>
                      Cash back
                      <small>Mama Put, Yaba</small>
                    </span>
                    <b>+₦500</b>
                  </li>
                  <li>
                    <span className="lp-ico lp-ico-lime">
                      <TicketCheck size={14} />
                    </span>
                    <span>
                      Prize code
                      <small>Every code wins</small>
                    </span>
                    <b>+₦5,000</b>
                  </li>
                  {jobsEnabled && (
                    <li>
                      <span className="lp-ico lp-ico-blue">
                        <Code2 size={14} />
                      </span>
                      <span>
                        Paid task
                        <small>Test a new app</small>
                      </span>
                      <b>+₦2,000</b>
                    </li>
                  )}
                </ul>
              </div>
            </div>

            <div className="lp-tag lp-tag-yellow" aria-hidden>
              <span className="lp-bars">
                <i style={{ height: '40%' }} />
                <i style={{ height: '70%' }} />
                <i style={{ height: '55%' }} />
                <i style={{ height: '95%' }} />
              </span>
              <span>
                <small>Shoppers who came back</small>
                <strong>+9</strong>
              </span>
            </div>
            <div className="lp-tag lp-tag-green" aria-hidden>
              <small>Prize claimed</small>
              <strong>₦5,000</strong>
              <span className="lp-tag-chip">Paid</span>
            </div>
            <div className="lp-tag lp-tag-pink" aria-hidden>
              <Lock size={13} /> Prepaid by the business
            </div>
            <span className="lp-orb" aria-hidden>
              <ArrowDownRight size={30} />
            </span>
            <span className="lp-example">Example</span>
          </div>
        </section>

        <div className="lp-marquee" aria-label="Built for">
          <div className="lp-marquee-track">
            {[0, 1].map((copy) => (
              <ul key={copy} aria-hidden={copy === 1 || undefined}>
                {sectors.map(({ icon: Icon, label }) => (
                  <li key={label}>
                    <Icon size={20} aria-hidden /> {label}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        <section
          className="lp-section lp-reveal"
          aria-labelledby="steps-heading"
        >
          <div className="lp-split">
            <div>
              <p className="eyebrow">How it works</p>
              <h2 id="steps-heading">
                Three steps. <em className="lp-serif">No catch.</em>
              </h2>
            </div>
            <p>
              The reward is already paid in by the business, so the only thing
              between you and it is something real: a purchase, a prize code or
              finished work.
            </p>
          </div>
          <ol className="lp-steps">
            <li>
              <span className="lp-step-icon" aria-hidden>
                <Store size={26} strokeWidth={1.75} />
              </span>
              <h3>Pick an offer</h3>
              <p>
                Cash back from a business near you, a prize code from a pack
                {jobsEnabled ? ', or a paid task' : ''}.
              </p>
            </li>
            <li>
              <span className="lp-step-icon" aria-hidden>
                <BadgeCheck size={26} strokeWidth={1.75} />
              </span>
              <h3>Do the real thing</h3>
              <p>
                Buy as usual
                {jobsEnabled
                  ? ', claim your code or finish the task'
                  : ' or claim your code'}
                . It is checked before you are paid.
              </p>
            </li>
            <li>
              <span className="lp-step-icon" aria-hidden>
                <Wallet size={26} strokeWidth={1.75} />
              </span>
              <h3>Get paid</h3>
              <p>
                The money moves to your wallet. Withdraw to any Nigerian bank.
              </p>
            </li>
          </ol>
        </section>

        <section
          id="earn"
          className="lp-section lp-reveal"
          aria-labelledby="earn-heading"
        >
          <div className="lp-split">
            <div>
              <p className="eyebrow">Three ways to earn</p>
              <h2 id="earn-heading">
                Real money for <em className="lp-serif">real activity.</em>
              </h2>
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
                    Every code wins
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
                Found a code on a pack or card? Claim it here. Every code wins,
                and the prize money was locked before the codes were printed.
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
                    {jobsEnabled
                      ? '6 paid jobs · 2 repeat clients'
                      : '23 purchases · 7 businesses'}
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
                <h3 style={{ margin: 0 }}>
                  {jobsEnabled ? 'Paid work with proof' : 'A record you earn'}
                </h3>
              </div>
              <p className="small-note">
                {jobsEnabled
                  ? 'Work for businesses with the pay locked in advance. Every paid job adds to a record nobody can fake.'
                  : 'Every confirmed purchase adds to a public record nobody can fake: proof you are a real, regular customer.'}
              </p>
            </li>
          </ul>
        </section>

        <section
          id="businesses"
          className="lp-section lp-reveal"
          aria-labelledby="business-heading"
        >
          <div className="lp-split">
            <div>
              <p className="eyebrow">For businesses</p>
              <h2 id="business-heading">
                Pay for results, <em className="lp-serif">not for views.</em>
              </h2>
            </div>
            <p>
              No ads, no follows. You lock the money first, and it is only paid
              out when something real happens.
            </p>
          </div>
          <ul className="features">
            {audiences.map(({ icon: Icon, who, title, body, cta }) => (
              <li key={who} className="lp-audience">
                <span className="lp-audience-icon" aria-hidden>
                  <Icon size={20} />
                </span>
                <p className="eyebrow" style={{ margin: 0 }}>
                  {who}
                </p>
                <h3>{title}</h3>
                <p className="small-note">{body}</p>
                <Link className="text-link" href="/business">
                  {cta} <ArrowRight size={14} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="band lp-reveal" aria-labelledby="cta-heading">
          <div className="grid gap-4" style={{ position: 'relative' }}>
            <h2 id="cta-heading" style={{ margin: 0 }}>
              Run your first campaign <em className="lp-serif">this week.</em>
            </h2>
            <p style={{ margin: 0, maxWidth: '46ch' }}>
              {jobsEnabled
                ? 'Cash back, prize codes or paid tasks.'
                : 'Cash back or prize codes.'}{' '}
              You fund it, we verify every claim, and you see the results.
            </p>
            <EmailCapture />
            <Link className="lp-band-link" href="/help">
              How it works <ArrowRight size={14} aria-hidden />
            </Link>
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
      </main>
      <footer className="lp-footer">
        <div className="lp-footer-top">
          <div className="lp-footer-brand">
            <Brand />
            <p className="small-note">
              Cash back, prize codes{jobsEnabled ? ' and paid tasks' : ''},
              prepaid by real businesses.
            </p>
            <SocialLinks />
          </div>
          <nav aria-label="Acticlaim">
            <p className="lp-footer-head">Acticlaim</p>
            <a href="#earn">How you earn</a>
            <a href="#businesses">For businesses</a>
            <Link href="/help">Help</Link>
          </nav>
          <nav aria-label="Legal">
            <p className="lp-footer-head">Legal</p>
            <Link href="/terms">Terms of service</Link>
            <Link href="/privacy">Privacy policy</Link>
            <Link href="/terms/business">Business terms</Link>
          </nav>
        </div>
        <div className="lp-footer-bottom">
          <span>
            © {new Date().getFullYear()} Acticlaim. All rights reserved.
          </span>
        </div>
      </footer>
    </>
  );
}
