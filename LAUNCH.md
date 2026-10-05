# Launching Acticlaim

Launch scope: cash back offers, prize codes and vouchers, wallet, profiles and reviewer tools. Paid small tasks (jobs) are switched off. It starts on Bachs sandbox keys (no real money moves; the server logs a `payments_sandbox` warning) and switches to live keys later, as in section 7.

Never paste a key or password into chat or Git. Add each one as a secret where the steps say.

## 1. Accounts the owner creates

| #   | Service                          | What to do                                                                                                                                                                      | What it gives                                                                    |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | Domain (Cloudflare)              | Buy or move the domain (for example `acticlaim.com`) to Cloudflare.                                                                                                             | `acticlaim.com` for the website, `api.acticlaim.com` for the server              |
| 2   | Supabase                         | Create a project in the region nearest Nigeria. Keep the database password.                                                                                                     | The database connection string                                                   |
| 3   | Google Cloud                     | Create a project with billing turned on (the free allowance covers early traffic). Enable Cloud Run, Cloud Scheduler, Artifact Registry and Secret Manager. Set a budget alert. | Hosting for the server and the scheduled jobs                                    |
| 4   | Vercel                           | Sign in with the GitHub account that owns `ezekiel37/Pointrush`.                                                                                                                | Hosting for the website                                                          |
| 5   | Resend                           | Add the domain and the DNS records it asks for in Cloudflare.                                                                                                                   | Sending email from `accounts@acticlaim.com`                                      |
| 6   | Bachs                            | Start with sandbox keys. Add the webhook URL `https://api.acticlaim.com/api/v1/payments/webhooks/bachs`.                                                                        | `sk_sandbox_…` API key and webhook signing secret (live ones later)              |
| 7   | SMS (Termii or Africa's Talking) | Register a sender ID (approval can take days, so start early).                                                                                                                  | API key. **The adapter is not built yet; tell Claude which provider you chose.** |

## 2. Server settings (Cloud Run secrets)

| Setting                     | Value                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| `NODE_ENV`                  | `production`                                                                             |
| `FEATURE_JOBS`              | `off`                                                                                    |
| `CORS_ORIGINS`              | `https://acticlaim.com`                                                                  |
| `AUTH_BASE_URL`             | `https://api.acticlaim.com`                                                              |
| `AUTH_TRUSTED_ORIGINS`      | `https://acticlaim.com`                                                                  |
| `AUTH_SECRET`               | 48 random characters (`openssl rand -base64 36`)                                         |
| `AUTH_EMAIL_ENCRYPTION_KEY` | 64 hex characters (`openssl rand -hex 32`); the same value for the email job             |
| `EMAIL_FROM`                | `accounts@acticlaim.com`                                                                 |
| `DATABASE_URL`              | Supabase connection string for the app user                                              |
| `PAYMENTS_PROVIDER`         | `bachs`                                                                                  |
| `BACHS_API_KEY`             | `sk_sandbox_…` now, `sk_live_…` at the switch (a live key is refused outside production) |
| `PAYMENTS_WEBHOOK_SECRET`   | Bachs webhook signing secret                                                             |
| `PAYMENTS_RETURN_ORIGIN`    | `https://acticlaim.com`                                                                  |
| `SPONSOR_TERMS_VERSION`     | Version of the business terms, for example `2026-10`                                     |

Database setup uses `MIGRATION_DATABASE_URL` (a user allowed to change tables), run once per release with `npm run db:migrate --workspace @pointrush/api`.

## 3. Website settings (Vercel)

| Setting                    | Value                       |
| -------------------------- | --------------------------- |
| `NEXT_PUBLIC_API_ORIGIN`   | `https://api.acticlaim.com` |
| `NEXT_PUBLIC_FEATURE_JOBS` | `off`                       |

Root directory `apps/web`. Changing any of these needs a rebuild.

## 4. Scheduled jobs (Cloud Run Jobs started by Cloud Scheduler)

| Job          | Command                                            | How often       | Needs                                                                                 |
| ------------ | -------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------- |
| Send emails  | `node apps/api/dist/auth/email-worker-cli.js`      | Every minute    | `DATABASE_URL`, `RESEND_API_KEY`, `AUTH_EMAIL_ENCRYPTION_KEY`                         |
| Send payouts | `node apps/api/dist/payments/payout-worker-cli.js` | Every 5 minutes | The server settings. Exit code 2 means a payout was deferred and someone should look. |

## 5. Before inviting anyone

1. Run the database setup, then appoint the first reviewers (`npm run reviewers:provision`, see ADMIN_ACCESS_PLAN.md) and turn on their authenticator app.
2. Daily database backup, and one test restore.
3. End-to-end run on the real site: sign up, verify email and phone, fund a campaign by bank transfer, confirm a purchase at the till, release cash back, withdraw, claim a prize code, void and dispute.
4. Cloudflare rate limits on `api.acticlaim.com` (SECURITY_REVIEW.md, M6).

## 6. Open risks at launch

- No lawyer's opinion yet on the money model (SECURITY_REVIEW.md, C2).
- No written approval of the model from Bachs yet.
- No daily check that the Bachs balance covers what Acticlaim owes (M3).
- A person must be on duty for void disputes and flagged payments.

## 7. Switching from sandbox to live keys

The code does not change; the keys and the database do. Money recorded while on the sandbox never existed in the Bachs balance, and bank accounts saved during the sandbox are registered only in the sandbox. A database that has run on sandbox keys must therefore never run on live keys: Acticlaim would owe businesses and shoppers money it never received. Money records are append-only by design, so they cannot be cleaned out row by row.

Use two Supabase projects from the start:

| Stage   | Database         | Bachs keys                                    |
| ------- | ---------------- | --------------------------------------------- |
| Testing | `acticlaim-test` | `sk_sandbox_…` and the sandbox webhook secret |
| Live    | `acticlaim-live` | `sk_live_…` and the live webhook secret       |

To switch:

1. Create `acticlaim-live` and run the database setup on it.
2. In Cloud Run (server and both scheduled jobs), change `DATABASE_URL`, `BACHS_API_KEY` and `PAYMENTS_WEBHOOK_SECRET`, then redeploy. Add the live webhook URL in the Bachs live dashboard.
3. Appoint reviewers again in the live database.
4. Tell testers to sign up again; their test accounts and balances stay in `acticlaim-test`, which can then be deleted.
