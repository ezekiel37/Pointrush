# Authentication foundation

Status: internal, not mounted in NestJS. No public signup/login is enabled by this commit. Better Auth 1.7.6 owns password hashing, verification, reset tokens and database-backed sessions; Resend is the selected email delivery implementation. No live email has been sent or provider account configured.

## Implemented boundaries

- Authentication uses separate PostgreSQL tables, migrated by Drizzle with the existing application migration runner. Better Auth's credential `account` model is explicitly mapped to `auth_credentials`, never PointRush `accounts`.
- Signup creates only an authentication identity. It does not claim a username, verify a phone, establish legal identity, grant a role or approve a sponsor.
- Email verification is required before password login. Neither signup nor verification automatically creates a session.
- Passwords use Better Auth's default scrypt implementation, with a 15–128 character policy. No custom hashing or password/token logging.
- Password reset identifiers are stored hashed; successful resets revoke existing sessions. Cookie caching is disabled, so revoked sessions are checked against the database.
- Explicit origin allowlists; no wildcards. HTTPS is required except loopback development. Cookies are host-only, HTTP-only, SameSite=Lax and Secure on HTTPS. Cross-subdomain cookies and account linking are not enabled.
- Resend messages use plain text and never interpolate display names into HTML. Provider failures become a generic delivery error without leaking addresses or links. No console email fallback exists.
- Built-in auth logging is disabled to avoid accidental sensitive payload logging. Safe structured security-event logging is a release gate, not implemented here.

Security defaults in this slice: verification link 1 hour; reset link 30 minutes; sessions 7 days with daily refresh. These are configuration choices, not promises of final launch policy. Fresh authentication for sensitive actions still needs implementation.

## Required before mounting routes

1. Validate production configuration and secrets at startup. Generate a high-entropy auth secret (minimum 32 characters is only a length check), store it and the Resend API key in Secret Manager, verify the sender domain, and use a stable API origin. Define rotation and recovery procedures.
2. Mount the handler with a strict body-size limit, safe parser errors, request IDs, security headers and credentialed exact-origin CORS. Preserve Better Auth origin/CSRF checks. Test this through the actual Nest/Express server, not only Web Requests.
3. Strip client-supplied `x-pointrush-client-ip` and set it only from a validated deployment-specific client-IP policy. The internal factory reads only that header; it is NOT safe to expose directly. Validate Cloud Run ingress/proxy behavior before trusting forwarded headers.
4. Built-in rate limits use PostgreSQL storage (30 requests per minute, plus library endpoint-specific defaults). This is not proof of race-safe distributed abuse prevention. Verify multi-instance concurrency and implement atomic abuse controls, per-account/email throttles, cost limits and cleanup before public signup.
5. Add default-deny Nest session/permission guards and explicitly public routes. Link a verified auth identity to exactly one PointRush account using a transactional, unique, retry-safe onboarding command. Never accept the acting account ID from the browser. Enforce restricted/suspended/closed status on business operations.
6. Define email outage behavior, safe retries, delivery budgets, verification resend throttling and a welcome-email event. Test duplicate signup and email enumeration, including timing and failure paths. Do not claim an email was delivered merely because the provider accepted it.
7. Add MFA/step-up protection for administrators and sensitive actions; session management UI; safe security audit events; expired-record cleanup; retention policies. Database session tokens remain sensitive bearer material in the library's storage model: restrict database/backup access and never expose or log rows.
8. Run native PostgreSQL and deployed-browser integration tests. The automated auth tests use the real library and PGlite PostgreSQL, but cannot prove network pool behavior, native concurrency, browser cookie behavior or provider delivery. Readiness currently checks the existing account schema, not auth readiness.

## Local verification

`npm run check` covers auth config rejection, signup isolation, stored password hashing, unverified login rejection, email verification, cookie attributes, reset token replay rejection, session revocation, expired sessions, untrusted origins and redirects, password bounds, reset-response parity, and email template/sender validation. Test email is captured only in an in-memory mailbox; no real Resend request is made.

References: [Better Auth Express integration](https://better-auth.com/docs/integrations/express), [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [email/password](https://better-auth.com/docs/authentication/email-password), [rate limits](https://better-auth.com/docs/concepts/rate-limit), [Resend email API](https://resend.com/docs/api-reference/emails/send-email). Integration was also checked against the pinned installed package types and implementation.
