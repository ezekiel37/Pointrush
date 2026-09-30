'use client';
import { useSyncExternalStore } from 'react';
import type { ComponentProps } from 'react';
const subscribe = () => () => {};
const hydrated = () => true;
const server = () => false;
// Prevent native pre-hydration submission from putting credentials in a URL.
export function Form({ children, ...props }: ComponentProps<'form'>) {
  const ready = useSyncExternalStore(subscribe, hydrated, server);
  return (
    <form {...props} noValidate method="post">
      <fieldset disabled={!ready || Boolean(props['aria-busy'])}>
        {children}
      </fieldset>
      <p className="form-readiness" role="status">
        {!ready
          ? 'Loading the form. Enable JavaScript if it does not open.'
          : null}
      </p>
    </form>
  );
}
