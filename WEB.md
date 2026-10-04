# Account web application

`apps/web` is the Next.js App Router account shell. NestJS remains the only authentication and business backend. The UI contains signup, verification resend, login, password recovery/reset, onboarding, an account summary, restriction states and account FAQs. It does not contain task, funding, redemption, push or operational-support features yet.

## Run locally

Use Node 24. From the repository root:

```sh
npm ci
npm run build --workspace @pointrush/contracts
cp apps/web/.env.example apps/web/.env.local
npm run dev:web
```

The web app listens on port 3000. Run the configured API separately with `npm run dev:api`. Configure a database and all authentication settings from `apps/api/.env.example`, apply migrations, and invoke the email worker as documented in `EMAIL_QUEUE.md`. There is no development mail-to-console fallback. Without API configuration the UI shows a recoverable service error.

- Web: `http://localhost:3000`
- API `AUTH_BASE_URL` and web `NEXT_PUBLIC_API_ORIGIN`: `http://localhost:8080`
- API `CORS_ORIGINS` and `AUTH_TRUSTED_ORIGINS`: `http://localhost:3000`

Use the same hostname on both services. Mixing localhost and 127.0.0.1 creates a different cookie site. In production use HTTPS origins on the same schemeful site, such as app.example.com and api.example.com. Unrelated hosting domains are not supported by the current SameSite=Lax cookie contract. Set the public API origin at build time; it is a public URL, never a secret. Never put auth secrets or provider keys in web environment variables.

The web app sends requests directly to NestJS with credentials and no-store caching. There is no general-purpose proxy, duplicated auth server or client-readable session token. Static page shells contain no private account data; only the authenticated browser request obtains account details. Client route handling is UX, not authorization.

## UI and validation ownership

Shared shadcn-derived Button/Input primitives use Tailwind semantic tokens; Field owns labels, help, errors and password visibility. React Hook Form owns form state and focus; Zod validates input. Identity schemas and password-length constants live in `packages/contracts` and are consumed by both API and web. Backend transaction and permission checks remain authoritative.

The contract package is built by its prepare script during normal installation and before the root typecheck/build. `npm ci --ignore-scripts` requires manually running its build before API tests. The API Dockerfile now includes this workspace and its compiled runtime output; frontend dependencies are not installed in the API runtime stage.

Forms are disabled before hydration, use noValidate and POST fallback, and lock submission while processing. Password managers/paste work; passwords and reset tokens are never written to browser storage. The reset page removes its token query after capturing it in component memory. Token-bearing incoming URLs still reach hosting infrastructure: redact query strings from access logs, error reporting and analytics before deployment. No third-party analytics are included. Referrer-Policy is no-referrer.

Writes have bounded requests and no automatic retries. An ambiguous network result is not described as a confirmed failure. Onboarding retains entries in memory through conflict/session errors and permits sign-in in a separate tab. Closing/reloading discards these entries. Account reads refresh on initial mount, online and visibility events; superseded requests are aborted. No polling timer is used.

## Verification

```sh
npm run check
npx playwright install chromium
npm run test:e2e --workspace @pointrush/web
```

The browser suite starts Next.js and a **loopback-only test NestJS server** backed by PGlite. The server is under `apps/api/test/helpers`, requires `POINTRUSH_BROWSER_TEST=1`, uses fresh synthetic identities and captures email in memory. It is excluded from production compilation. Its test-only mailbox must never be deployed. No real emails or provider accounts are used. Rate-limit/quota and native-concurrency coverage remain in the API suites; this fixture is not evidence for production email delivery.

Browser tests cover the real signup → verification → login → onboarding → signout → reset → login journey. Separate intercepted responses exercise 503, restrictions, expired sessions, conflicts, duplicate submissions and offline recovery. Automated axe checks cover signup, login errors and account summary. Tests also check pre-hydration safeguards and narrow-screen overflow. Screenshots are local test artifacts, not production records.

An optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE` allows a preinstalled test browser. In this environment the current browser archive was truncated, so verification used Chromium 141 from Playwright 1.56.1 with the installed Playwright runner. Re-run against the current supported Chromium plus Safari/Firefox before launch. The UI audit (`premium-ui.json`) is static evidence, not a substitute for browser tests.

ESLint is pinned to 9.39.5 for compatibility with the Next 16.3.6 React lint plugin; ESLint 10 failed on the plugin's removed context APIs. This is development tooling, not runtime code. Track a compatible supported upgrade. One scoped React hook lint exception documents the initial bounded account fetch; request cancellation and state transitions are exercised in browser tests.

## Remaining release work

This change does not deploy the app. Production browser cookie/domain testing, native PostgreSQL concurrency, live email sender/worker verification, restrictive CSP with a reviewed Next.js nonce strategy, HSTS/ingress policy, log redaction, endpoint abuse limits and security audit events remain gates. Physical Android/iOS keyboard, 200% zoom and assistive-technology verification also remain. No claim of full WCAG conformance is made from automated checks alone.

PWA manifest/service worker/offline policy and push are not implemented. Private auth/account data must never enter an offline cache when those features are added. Terms/privacy copy, support contact/appeals and welcome email are not invented in this slice.

The selected host is Vercel, with Cloudflare DNS-only for the web hostname initially. NestJS runs on Cloud Run and remains the only business backend. Retain NEXT_PUBLIC_API_ORIGIN rather than rename it. Review the broad no-store header rule before introducing cacheable public content; never cache private account/auth responses. Future push uses FCM with Acticlaim-owned PostgreSQL notifications/preferences and multiple device registrations. Browser permission and iOS Home Screen requirements remain; push cannot guarantee delivery. See [infrastructure decisions](INFRASTRUCTURE.md) for boundaries and release sequencing.

Sources used: [Next installation](https://nextjs.org/docs/app/getting-started/installation), [Next headers](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers), [Better Auth client usage](https://better-auth.com/docs/basic-usage), [shadcn Button](https://ui.shadcn.com/docs/components/radix/button), [shadcn forms](https://ui.shadcn.com/docs/forms/react-hook-form). Shared Button/Input follow shadcn's MIT-licensed source patterns with Acticlaim styling.
