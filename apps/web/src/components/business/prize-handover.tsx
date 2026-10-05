'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { apiRequest } from '@/lib/api';
import { RequestError } from '@/lib/auth-client';
import { handover } from '@/lib/rewards';
import { CodeScanner } from './code-scanner';

function handoverError(error: unknown) {
  if (error instanceof RequestError) {
    if (error.code === 'voucher_unknown' || error.status === 400)
      return 'This voucher is not valid for this promotion. Check the 12 characters.';
    if (error.code === 'prize_settled')
      return 'This prize was already collected, or the winner took its cash value. Do not hand it over.';
  }
  return 'We could not confirm the handover. Check your connection and try again; it is recorded once.';
}

// Scan or type the winner's voucher, then hand the item over.
export function PrizeHandover({
  taskId,
  item,
}: {
  taskId: string;
  item: string;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!code.trim()) {
      setError("Scan or type the winner's voucher code.");
      return;
    }
    setBusy(true);
    setError('');
    setDone('');
    try {
      const result = await apiRequest(
        `promotions/${taskId}/handovers`,
        handover,
        {
          method: 'POST',
          body: { code: code.trim() },
        },
      );
      setDone(
        `Hand over ${result.item} now. Its deposit returns to your balance.`,
      );
      setCode('');
    } catch (cause) {
      setError(handoverError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card grid gap-4" onSubmit={submit} noValidate>
      <div className="card-head">
        <h2>Hand over a prize</h2>
        <p>
          Winners show a voucher for {item}. Confirm it here before handing the
          item over.
        </p>
      </div>
      <CodeScanner onCode={setCode} />
      <Field
        id="voucher-code"
        label="Voucher code"
        className="input-code"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="XXXX XXXX XXXX"
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          setError('');
        }}
      />
      {done && <Feedback>{done}</Feedback>}
      {error && <Feedback error>{error}</Feedback>}
      <Button variant="accent" type="submit" disabled={busy}>
        {busy ? 'Checking voucher…' : 'Confirm handover'}
      </Button>
    </form>
  );
}
