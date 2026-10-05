import Link from 'next/link';
export function ReviewAccess() {
  return (
    <p className="small-note">
      Reviewing requires an active reviewer appointment and a recent
      authenticator check.{' '}
      <Link
        className="text-link"
        href="/two-factor"
        target="_blank"
        rel="noopener noreferrer"
      >
        Verify authenticator in another tab
      </Link>
      , then return and check the latest status. Backup codes do not authorize
      review.
    </p>
  );
}
