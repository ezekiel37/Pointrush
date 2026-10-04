'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { MapPin, RefreshCw, ShieldCheck } from 'lucide-react';
import type { z } from 'zod';
import { Page } from '@/components/shell/app-shell';
import { Button } from '@/components/ui/button';
import { Feedback, Loading } from '@/components/ui/feedback';
import { WorkFailure } from '@/components/work/work-frame';
import { apiRequest, naira, shortDate } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { offerDetail, purchaseCode } from '@/lib/rewards';
import { useApiRead } from '@/lib/use-api-read';

type Code = z.infer<typeof purchaseCode>;
const lifetimeMs = 15 * 60 * 1000;
const storageKey = (id: string) => `acticlaim:purchase-code:${id}`;

// The live code is kept on the device so the ticket opens at a till without
// signal. Storage can be unavailable (private mode); the ticket still works.
function loadCode(id: string): Code | null {
  try {
    const parsed = purchaseCode.safeParse(
      JSON.parse(localStorage.getItem(storageKey(id)) ?? 'null'),
    );
    return parsed.success && Date.parse(parsed.data.expiresAt) > Date.now()
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}
function saveCode(code: Code) {
  try {
    localStorage.setItem(storageKey(code.taskId), JSON.stringify(code));
  } catch {
    // Not persisted; shown from memory only.
  }
}

function codeError(error: unknown) {
  if (error instanceof RequestError) {
    if (error.status === 401) return 'Sign in to get your code.';
    if (error.code === 'offer_unavailable')
      return 'This offer is not available to you. You may have used it already, or it is not running right now.';
    if (error.code === 'code_rate_limit')
      return 'Too many codes requested. Use your latest code or try again later.';
  }
  return 'We could not get your code. Check your connection and try again.';
}

function Ticket({ code, onRenew }: { code: Code; onRenew: () => void }) {
  const [qr, setQr] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    void QRCode.toDataURL(code.code, {
      errorCorrectionLevel: 'M',
      margin: 0,
      scale: 8,
      color: { dark: '#141210', light: '#ffffff' },
    }).then((url) => live && setQr(url));
    return () => {
      live = false;
    };
  }, [code.code]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Date.parse(code.expiresAt) - now);
  const minutes = Math.floor(left / 60000);
  const seconds = Math.floor((left % 60000) / 1000);
  const expired = left === 0;
  return (
    <section className="ticket" aria-labelledby="ticket-heading">
      <div className="ticket-head">
        <p className="eyebrow">Show at the till</p>
        <h2 id="ticket-heading">Your purchase code</h2>
      </div>
      <div className="ticket-body">
        {expired ? (
          <>
            <p className="chip chip-muted">Expired</p>
            <p className="small-note">
              Codes last 15 minutes so a photo of one cannot be reused.
            </p>
            <Button variant="accent" onClick={onRenew}>
              <RefreshCw size={17} aria-hidden /> Get a new code
            </Button>
          </>
        ) : (
          <>
            {qr ? (
              // A data URL QR code; next/image adds nothing here.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="ticket-qr"
                src={qr}
                alt={`QR code for purchase code ${code.display}`}
              />
            ) : (
              <div className="ticket-qr" aria-hidden />
            )}
            <p
              className="ticket-code"
              aria-label={code.display.split('').join(' ')}
            >
              {code.display}
            </p>
          </>
        )}
      </div>
      <div className="ticket-perforation" aria-hidden />
      <div className="ticket-body" style={{ paddingTop: '1rem' }}>
        {!expired && (
          <div className="countdown">
            <div className="countdown-track" aria-hidden>
              <div
                className="countdown-fill"
                style={{ transform: `scaleX(${left / lifetimeMs})` }}
              />
            </div>
            <p className="small-note" role="timer" aria-live="off">
              Valid for {minutes}:{seconds.toString().padStart(2, '0')} more
            </p>
          </div>
        )}
        <p className="small-note">
          The cashier scans this or types the code. Works once, only for you.
        </p>
      </div>
    </section>
  );
}

export function OfferDetail({ id }: { id: string }) {
  const offer = useApiRead(`work/tasks/${id}`, offerDetail);
  const [code, setCode] = useState<Code | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    // Restore a live code saved on this device, if any.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCode(loadCode(id));
  }, [id]);

  async function getCode() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const issued = await apiRequest(`campaigns/${id}/codes`, purchaseCode, {
        method: 'POST',
        body: {},
      });
      saveCode(issued);
      setCode(issued);
    } catch (cause) {
      setError(codeError(cause));
    } finally {
      setBusy(false);
    }
  }

  const data = offer.data;
  const terms = data?.campaignTerms;
  return (
    <Page title={data?.title ?? 'Offer'} eyebrow="Cash back offer">
      {offer.loading && !data ? (
        <Loading>Loading offer…</Loading>
      ) : offer.error && !code ? (
        <WorkFailure error={offer.error} retry={offer.refresh} />
      ) : (
        <div
          className="grid gap-6"
          style={{
            gridTemplateColumns:
              'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
            alignItems: 'start',
          }}
        >
          <div className="grid gap-4">
            {code ? (
              <Ticket code={code} onRenew={() => void getCode()} />
            ) : (
              <section className="card grid gap-3">
                <p className="eyebrow">How it works</p>
                <ol
                  className="stack"
                  style={{ listStyle: 'decimal', paddingLeft: '1.25rem' }}
                >
                  <li>Get your code here before you pay.</li>
                  <li>Buy as normal and show the code at the till.</li>
                  <li>
                    Your cash back unlocks after the refund window, then you
                    move it to your wallet.
                  </li>
                </ol>
                {error && <Feedback error>{error}</Feedback>}
                <Button
                  variant="accent"
                  onClick={() => void getCode()}
                  disabled={busy}
                >
                  {busy ? 'Getting your code…' : 'Get my code'}
                </Button>
              </section>
            )}
            {code && error && <Feedback error>{error}</Feedback>}
          </div>
          {data && terms && (
            <section className="card grid gap-3">
              <p style={{ margin: 0 }}>
                <span className="amount amount-xl">
                  {naira(data.rewardBackingKobo)}
                </span>
                <span className="small-note"> back</span>
              </p>
              <dl className="grid gap-3" style={{ margin: 0 }}>
                <div>
                  <dt className="eyebrow">Minimum spend</dt>
                  <dd className="amount" style={{ margin: 0 }}>
                    {naira(terms.minSpendKobo)}
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow">Where</dt>
                  <dd style={{ margin: 0 }}>
                    <strong>{terms.placeName}</strong>
                    <br />
                    <span className="small-note icon-line">
                      <MapPin size={14} aria-hidden /> {terms.placeAddress}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow">When it unlocks</dt>
                  <dd style={{ margin: 0 }}>
                    {Math.round(terms.holdHours / 24)} day
                    {Math.round(terms.holdHours / 24) === 1 ? '' : 's'} after
                    purchase, so the business can handle refunds
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow">Places left</dt>
                  <dd className="num" style={{ margin: 0 }}>
                    {Math.max(0, data.capacity - data.claimed)} of{' '}
                    {data.capacity} · ends {shortDate(data.endsAt)}
                  </dd>
                </div>
              </dl>
              <p className="small-note work-prose">{data.instructions}</p>
              <p
                className="small-note row"
                style={{ justifyContent: 'flex-start' }}
              >
                <ShieldCheck size={16} aria-hidden /> Cash back is paid from
                money the business locked in advance. One per person.
              </p>
              <Link className="text-link" href="/offers">
                All offers
              </Link>
            </section>
          )}
        </div>
      )}
    </Page>
  );
}
