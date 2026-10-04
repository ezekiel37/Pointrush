'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
export function DraftGuard({
  dirty,
  busy,
  onDiscard,
}: {
  dirty: boolean;
  busy: boolean;
  onDiscard: () => void;
}) {
  const [leave, setLeave] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const navigate = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.('a');
      if (
        !a ||
        a.target === '_blank' ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        e.altKey ||
        e.button !== 0
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      setLeave(a.href);
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', navigate, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', navigate, true);
    };
  }, [dirty]);
  useEffect(() => {
    if (leave) panel.current?.focus();
  }, [leave]);
  if (!leave) return null;
  return (
    <div ref={panel} tabIndex={-1} className="account-panel" role="alert">
      <h2>Leave this draft?</h2>
      <p>
        Your unsent text will be lost. An action already sent may still have
        been recorded.
      </p>
      <Button variant="outline" onClick={() => setLeave(null)}>
        Keep writing
      </Button>
      <Button
        disabled={busy}
        onClick={() => {
          onDiscard();
          router.push(leave);
        }}
      >
        Discard draft and leave
      </Button>
    </div>
  );
}
