import Link from 'next/link';
import { AuthFrame } from '@/components/auth/auth-frame';
export default function NotFound() {
  return (
    <AuthFrame
      title="Page not found"
      description="This page may have moved, or the link is incomplete."
    >
      <Link className="text-link" href="/account">
        Go to your account
      </Link>
    </AuthFrame>
  );
}
