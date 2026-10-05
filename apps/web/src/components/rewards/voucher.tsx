'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Gift } from 'lucide-react';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { apiRequest, naira, shortDate } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import type { claimResult } from '@/lib/rewards';
import { z as zod } from 'zod';

type Claim = z.infer<typeof claimResult>;
const spaced = (code: string) => code.replace(/(.{4})(?=.)/g, '$1 ');

export const voucherLabel = {
  awaiting: ['Collect in store', 'chip chip-pending'],
  handed_over: ['Collected', 'chip chip-done'],
  cashed_out: ['Paid as cash', 'chip chip-done'],
} as const;

// An item prize: the code is shown only here, to the winner, so the business
// cannot mark it handed over without them.
export function Voucher({
  claim,
  onChange,
}: {
  claim: Claim;
  onChange: () => void;
}) {
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now] = useState(() => Date.now());
  const code = claim.voucherCode ?? '';
  const awaiting = claim.voucherState === 'awaiting';
  useEffect(() => {
    if (!code || !awaiting) return;
    let live = true;
    void QRCode.toDataURL(code, {
      errorCorrectionLevel: 'M',
      margin: 0,
      scale: 8,
      color: { dark: '#141210', light: '#ffffff' },
    }).then((url) => live && setQr(url));
    return () => {
      live = false;
    };
  }, [code, awaiting]);
  const cashReady =
    awaiting &&
    claim.cashAvailableAt != null &&
    Date.parse(claim.cashAvailableAt) <= now;

  async function cashOut() {
    setBusy(true);
    setError('');
    try {
      await apiRequest(`claims/${claim.id}/cash-outs`, zod.unknown(), {
        method: 'POST',
        body: {},
      });
      onChange();
    } catch (cause) {
      setError(
        cause instanceof RequestError && cause.code === 'prize_settled'
          ? 'This prize was already collected or paid.'
          : 'We could not pay the cash value. Try again; it will never pay twice.',
      );
    } finally {
      setBusy(false);
    }
  }

  const [label, chip] = voucherLabel[claim.voucherState ?? 'awaiting'];
  return (
    <section className="ticket" aria-label={`Voucher: ${claim.prizeItem}`}>
      <div className="ticket-head">
        <p className="eyebrow icon-line">
          <Gift size={14} aria-hidden /> {claim.businessName}
        </p>
        <h2>{claim.prizeItem}</h2>
      </div>
      <div className="ticket-body">
        {awaiting ? (
          <>
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="ticket-qr"
                src={qr}
                alt={`QR code for voucher ${spaced(code)}`}
              />
            ) : (
              <div className="ticket-qr" aria-hidden />
            )}
            <p className="ticket-code" aria-label={code.split('').join(' ')}>
              {spaced(code)}
            </p>
            <p className="small-note">
              Show this at {claim.businessName} to collect your prize. Keep it
              private: whoever presents it can collect.
            </p>
          </>
        ) : (
          <p className={chip}>{label}</p>
        )}
      </div>
      {awaiting && (
        <>
          <div className="ticket-perforation" aria-hidden />
          <div className="ticket-body" style={{ paddingTop: '1rem' }}>
            {cashReady ? (
              <>
                <p className="small-note">
                  Not handed over yet? You can take its cash value of{' '}
                  {naira(claim.prizeKobo)} instead.
                </p>
                {error && <Feedback error>{error}</Feedback>}
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void cashOut()}
                >
                  {busy ? 'Paying…' : `Take ${naira(claim.prizeKobo)} instead`}
                </Button>
              </>
            ) : (
              <p className="small-note">
                Its cash value of {naira(claim.prizeKobo)} is locked for you.
                {claim.cashAvailableAt &&
                  ` If the business has not handed it over by ${shortDate(claim.cashAvailableAt)}, you can take the cash instead.`}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
