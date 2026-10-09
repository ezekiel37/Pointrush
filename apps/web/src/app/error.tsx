'use client';
import { Button } from '@/components/ui/button';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main-content" className="standalone">
      <h1>This page could not load</h1>
      <p>Please try again. If the problem continues, return to sign in.</p>
      <Button onClick={reset}>Try again</Button>
      <a className="back-link" href="/login">
        Back to sign in
      </a>
    </main>
  );
}
