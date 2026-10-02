'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
export function TaskSearch({ query }: { query: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState(query);
  const [composing, setComposing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pendingQueries = useRef(new Set<string>());
  const commit = useCallback(
    (value: string) => {
      const p = new URLSearchParams();
      if (value.trim()) p.set('q', value.trim());
      if (value.trim() !== query) pendingQueries.current.add(value.trim());
      router.replace(`/tasks${p.size ? '?' + p : ''}`, { scroll: false });
    },
    [router, query],
  );
  useEffect(() => {
    // Acknowledging our navigation must not overwrite newer typing.
    if (pendingQueries.current.delete(query)) return;
    // Browser back/forward restores the committed query.
    setDraft(query);
  }, [query]);
  useEffect(() => {
    if (composing || draft.trim() === query) return;
    const timer = setTimeout(() => commit(draft), 300);
    return () => clearTimeout(timer);
  }, [draft, query, composing, commit]);
  return (
    <form
      noValidate
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (!composing) commit(draft);
      }}
      className="work-search"
    >
      <label htmlFor="task-search">Search task titles</label>
      <div className="flex gap-2 flex-wrap">
        <Input
          ref={input}
          id="task-search"
          type="search"
          maxLength={100}
          value={draft}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onChange={(e) => {
            setDraft(e.target.value);
            if (!e.target.value) commit('');
          }}
        />
        <Button type="submit">Search</Button>
        {draft && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraft('');
              commit('');
              input.current?.focus();
            }}
          >
            Clear search
          </Button>
        )}
      </div>
    </form>
  );
}
