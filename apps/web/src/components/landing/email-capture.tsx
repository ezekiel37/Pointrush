'use client';
import { useRouter } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';

export const SIGNUP_EMAIL_KEY = 'acticlaim:signup-email';

// Hands the typed email to the signup form through session storage, so it
// never appears in a URL or a server log.
export function EmailCapture() {
  const router = useRouter();
  return (
    <form
      className="lp-capture"
      action="/signup"
      onSubmit={(event) => {
        event.preventDefault();
        const email = new FormData(event.currentTarget).get('email');
        try {
          if (typeof email === 'string' && email.trim())
            sessionStorage.setItem(SIGNUP_EMAIL_KEY, email.trim());
        } catch {
          // Storage can be blocked; the signup form simply starts empty.
        }
        router.push('/signup');
      }}
    >
      <label className="sr-only" htmlFor="cta-email">
        Your email address
      </label>
      <input
        id="cta-email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="Your email"
        maxLength={254}
      />
      <button className="button button-accent" type="submit">
        Get started <ArrowUpRight size={16} aria-hidden />
      </button>
    </form>
  );
}
