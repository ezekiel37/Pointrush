'use client';
import { useEffect, useState } from 'react';
import { AtSign, Check, LoaderCircle, X } from 'lucide-react';
import { apiRequest } from '@/lib/api';
import { cleanHandle, handleCheck, handlePattern } from '@/lib/profiles';

type State =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok' }
  | { kind: 'bad'; message: string; suggestion?: string | null };

// A @handle input that checks availability as you type.
export function HandleField({
  value,
  onChange,
  current,
  disabled = false,
  label = 'Business handle',
  hint = 'Your link: acticlaim.com/b/your_handle. You can change it once, until your first campaign is approved.',
}: {
  value: string;
  onChange: (value: string, available: boolean) => void;
  // The business's current handle counts as available.
  current?: string | null;
  disabled?: boolean;
  label?: string;
  hint?: string;
}) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const handle = cleanHandle(value);

  useEffect(() => {
    let live = true;
    const report = (next: State) => {
      if (!live) return;
      setState(next);
      onChange(value, next.kind === 'ok');
    };
    if (!handle) {
      const timer = setTimeout(() => report({ kind: 'idle' }), 0);
      return () => {
        live = false;
        clearTimeout(timer);
      };
    }
    if (handle === current) {
      const timer = setTimeout(() => report({ kind: 'ok' }), 0);
      return () => {
        live = false;
        clearTimeout(timer);
      };
    }
    if (!handlePattern.test(handle) || handle.includes('__')) {
      const timer = setTimeout(
        () =>
          report({
            kind: 'bad',
            message:
              '3–30 lowercase letters, numbers or single underscores, starting with a letter.',
          }),
        0,
      );
      return () => {
        live = false;
        clearTimeout(timer);
      };
    }
    const timer = setTimeout(() => {
      report({ kind: 'checking' });
      apiRequest(
        `handles/check?handle=${encodeURIComponent(handle)}`,
        handleCheck,
      ).then(
        (r) =>
          report(
            r.available
              ? { kind: 'ok' }
              : {
                  kind: 'bad',
                  message:
                    r.reason === 'reserved'
                      ? `@${handle} is reserved.`
                      : `@${handle} is taken.`,
                  suggestion: r.suggestion,
                },
          ),
        () =>
          report({
            kind: 'bad',
            message: 'We could not check this handle. Try again.',
          }),
      );
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // onChange is a fresh function each render; the check follows the text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, current]);

  return (
    <div className="field">
      <label htmlFor="business-handle">{label}</label>
      <div className="input-wrap handle-input">
        <AtSign size={17} aria-hidden className="handle-at" />
        <input
          id="business-handle"
          className="input"
          value={value}
          disabled={disabled}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          maxLength={31}
          aria-invalid={state.kind === 'bad'}
          aria-describedby="business-handle-help"
          onChange={(event) => onChange(event.target.value, false)}
        />
        <span className="handle-state" aria-hidden>
          {state.kind === 'checking' && (
            <LoaderCircle size={17} className="spinner" />
          )}
          {state.kind === 'ok' && <Check size={17} />}
          {state.kind === 'bad' && <X size={17} />}
        </span>
      </div>
      <p
        id="business-handle-help"
        className={
          state.kind === 'bad' ? 'field-help field-error' : 'field-help'
        }
        role="status"
      >
        {state.kind === 'ok' && handle !== current
          ? `@${handle} is available.`
          : state.kind === 'bad'
            ? state.message
            : hint}
        {state.kind === 'bad' && state.suggestion && (
          <>
            {' '}
            <button
              type="button"
              className="link-button"
              onClick={() => onChange(state.suggestion!, false)}
            >
              Use @{state.suggestion}
            </button>
          </>
        )}
      </p>
    </div>
  );
}
