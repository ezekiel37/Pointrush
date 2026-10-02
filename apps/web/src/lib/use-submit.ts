'use client';
import { useRef, useState } from 'react';
import { errorMessage } from './auth-client';
export function useSubmit(mapError: (error: unknown) => string = errorMessage) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(mapError(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return { run, busy, error };
}
