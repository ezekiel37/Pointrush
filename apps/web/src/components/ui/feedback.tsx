import type { ReactNode } from 'react';
import { CircleAlert, Check, LoaderCircle } from 'lucide-react';
export function Feedback({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`feedback ${error ? 'feedback-error' : 'feedback-info'}`}
      role={error ? 'alert' : 'status'}
    >
      {error ? (
        <CircleAlert size={20} aria-hidden />
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
