import type { ReactNode } from 'react';
import { Check, CircleAlert, Info, LoaderCircle } from 'lucide-react';
// Info confirms something worked; a warning says what is needed before
// something can happen; an error says it failed.
export function Feedback({
  children,
  error = false,
  warning = false,
}: {
  children: ReactNode;
  error?: boolean;
  warning?: boolean;
}) {
  return (
    <div
      className={`feedback ${error ? 'feedback-error' : warning ? 'feedback-warning' : 'feedback-info'}`}
      role={error ? 'alert' : 'status'}
    >
      {error ? (
        <CircleAlert size={20} aria-hidden />
      ) : warning ? (
        <Info size={20} aria-hidden />
      ) : (
        <Check size={20} aria-hidden />
      )}
      <div>{children}</div>
    </div>
  );
}
export function Loading({
  children = 'Loading your account…',
}: {
  children?: ReactNode;
}) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spinner" aria-hidden size={22} />
      {children}
    </div>
  );
}
