'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { CalendarDays, History, Store, Tag, TicketCheck } from 'lucide-react';
import { Brand } from '@/components/auth/auth-frame';
import { Loading } from '@/components/ui/feedback';
import { naira, shortDate } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { publicBusiness } from '@/lib/profiles';
import { publicFileUrl } from '@/lib/files';
import { useApiRead } from '@/lib/use-api-read';

const month = (iso: string) =>
  new Intl.DateTimeFormat('en-NG', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Lagos',
  }).format(new Date(iso));

// A business's shareable page: who they are, what they were called before,
// and their live offers. Readable without signing in.
export function PublicBusiness({ handle }: { handle: string }) {
  const router = useRouter();
  const read = useApiRead(`businesses/${handle}`, publicBusiness);
  const data = read.data;
  const redirect = data && 'redirect' in data ? data.redirect : null;
  useEffect(() => {
    // An old handle leads to the business's current one.
    if (redirect) router.replace(`/b/${redirect}`);
  }, [redirect, router]);
  const missing =
    read.error instanceof RequestError && read.error.status === 404;
  const b = data && !('redirect' in data) ? data : null;

  return (
    <>
      <header className="app-bar">
        <Brand />
        <div className="app-bar-end">
          <Link className="button button-outline" href="/signup">
            Join Acticlaim
          </Link>
        </div>
      </header>
      <main id="main-content" className="app-main" style={{ maxWidth: 760 }}>
        {(read.loading && !data) || redirect ? (
          <Loading>Loading business…</Loading>
        ) : missing ? (
          <section className="card grid gap-3">
            <h1 style={{ margin: 0 }}>No business here</h1>
            <p className="small-note">
              Check the link. Business pages look like acticlaim.com/b/name.
            </p>
            <Link
              className="button button-outline"
              href="/offers"
              style={{ justifySelf: 'start' }}
            >
              See offers
            </Link>
          </section>
        ) : read.error ? (
          <p className="small-note">
            We could not load this business. Check your connection and try
            again.
          </p>
        ) : (
          b && (
            <div className="grid gap-5">
              <section className="business-hero">
                {b.logoFileId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="logo-img"
                    src={publicFileUrl(b.logoFileId)}
                    alt={`${b.name} logo`}
                  />
                ) : (
                  <span className="business-mark" aria-hidden>
                    <Store size={28} />
                  </span>
                )}
                <div style={{ minWidth: 0 }}>
                  <h1>{b.name}</h1>
                  <p className="business-handle">@{b.handle}</p>
                  <p className="small-note icon-line">
                    <CalendarDays size={15} aria-hidden /> On Acticlaim since{' '}
                    {month(b.since)}
                  </p>
                </div>
              </section>
              {b.formerly.length > 0 && (
                <p className="formerly icon-line">
                  <History size={16} aria-hidden />
                  <span>
                    Formerly{' '}
                    {b.formerly.map((f, i) => (
                      <span key={f.until}>
                        {i > 0 && ', '}
                        <strong>{f.name}</strong> (until {shortDate(f.until)})
                      </span>
                    ))}
                  </span>
                </p>
              )}
              {b.description && (
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                  {b.description}
                </p>
              )}
              <section aria-labelledby="live-heading">
                <h2 id="live-heading">Live offers</h2>
                {b.offers.length ? (
                  <ul className="tx-list">
                    {b.offers.map((o) => (
                      <li key={o.id}>
                        <Link
                          href={
                            o.model === 'claim_code'
                              ? '/claim'
                              : `/offers/${o.id}`
                          }
                          className="tx-row"
                          style={{ color: 'inherit', textDecoration: 'none' }}
                        >
                          <span className="tx-icon" aria-hidden>
                            {o.model === 'claim_code' ? (
                              <TicketCheck size={18} />
                            ) : (
                              <Tag size={18} />
                            )}
                          </span>
                          <span className="tx-main">
                            <span
                              className="tx-title truncate"
                              style={{ display: 'block' }}
                            >
                              {o.title}
                            </span>
                            <span className="small-note">
                              Ends {shortDate(o.endsAt)}
                            </span>
                          </span>
                          <span className="amount">
                            {naira(o.rewardKobo)}
                            {o.model === 'claim_code' ? ' prize' : ' back'}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="small-note">No live offers right now.</p>
                )}
              </section>
            </div>
          )
        )}
      </main>
    </>
  );
}
