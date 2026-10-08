# Deploying Acticlaim on Brimble, step by step

A low-cost alternative to LAUNCH.md (Google Cloud), with no prepayment:

| Part                    | Where                                        | Cost                                         |
| ----------------------- | -------------------------------------------- | -------------------------------------------- |
| Server + scheduled jobs | Brimble (7-day Developer trial, then Hacker) | $0 for the trial week, then about $7 a month |
| Website                 | Vercel                                       | Free                                         |
| Database                | Supabase                                     | Free (no backups, pauses after a week idle)  |
| Email                   | Resend                                       | Free up to 3,000 a month                     |
| Domain and DNS          | Cloudflare                                   | About $10 a year                             |

The examples use `acticlaim.com`; replace it with your domain everywhere. Never put a key or password in Git or in a chat. Each secret goes only into Brimble's or Vercel's environment variable settings.

Brimble's screens may name things slightly differently from these steps. If a step does not match what you see, describe the screen to Claude (without keys).

## 1. Accounts

1. **Cloudflare**: buy the domain, or move it there.
2. **Supabase**: create a project named `acticlaim-test` in **Central EU (Frankfurt)** and save the database password.
3. **Brimble**: start the 7-day Developer trial. Check whether it charges automatically on day 7. Either way, switch to **Hacker** before the trial ends.
4. **Vercel**: sign up with the GitHub account that owns `ezekiel37/Pointrush`.
5. **Resend**: add your domain, copy the DNS records it shows into Cloudflare, and create an API key.
6. **Bachs**: in the sandbox, copy the API key (`sk_sandbox_…`). The webhook comes in step 6.
7. **SMS (Termii or Africa's Talking)**: request a sender ID now. Until Claude connects it, phone verification shows "not available yet", so withdrawals and prize claims wait.

## 2. Database details (Supabase)

1. Open **Connect** and copy the **Session pooler** connection string (port 5432). Put your password in place of `[YOUR-PASSWORD]`.
2. Under **Database settings → SSL**, download the certificate file and open it in a text editor. You will paste its whole text (from `-----BEGIN CERTIFICATE-----` to `-----END CERTIFICATE-----`) into Brimble.

## 3. Create the server on Brimble

1. **New project → Import from GitHub** and choose `Pointrush`, branch `develop`.
2. Choose **Docker** deployment with the Dockerfile `apps/api/Dockerfile`. The build must use the **repository root** as its folder (the Dockerfile copies files from several folders). If the build fails with "file not found", tell Claude.
3. **Region: Germany.** It is close to the Supabase database, and every request makes several database trips.
4. **Size**: the smallest available (0.5–1 vCPU, 512 MB–1 GB memory) is enough. Use one instance; the Hacker plan has no autoscaling.
5. **Port**: 8080. **Health check path**: `/api/v1/health/live`.

## 4. Server settings (Brimble environment variables)

| Name                        | Value                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `NODE_ENV`                  | `production`                                                                                |
| `FEATURE_JOBS`              | `off`                                                                                       |
| `DATABASE_URL`              | The Supabase session pooler string                                                          |
| `MIGRATION_DATABASE_URL`    | The same string                                                                             |
| `DATABASE_CA_CERT`          | The certificate text. If the box takes only one line, join the lines with `\n` between them |
| `DATABASE_POOL_MAX`         | `3`                                                                                         |
| `CORS_ORIGINS`              | `https://acticlaim.com`                                                                     |
| `AUTH_BASE_URL`             | `https://api.acticlaim.com`                                                                 |
| `AUTH_TRUSTED_ORIGINS`      | `https://acticlaim.com`                                                                     |
| `AUTH_SECRET`               | A random 48-character string (a password manager can generate one)                          |
| `AUTH_EMAIL_ENCRYPTION_KEY` | Exactly 64 characters using only `0-9` and `a-f` (see below)                                |
| `EMAIL_FROM`                | `accounts@acticlaim.com`                                                                    |
| `RESEND_API_KEY`            | The Resend key                                                                              |
| `PAYMENTS_PROVIDER`         | `bachs`                                                                                     |
| `BACHS_API_KEY`             | `sk_sandbox_…`                                                                              |
| `PAYMENTS_WEBHOOK_SECRET`   | From step 6                                                                                 |
| `PAYMENTS_RETURN_ORIGIN`    | `https://acticlaim.com`                                                                     |
| `SPONSOR_TERMS_VERSION`     | `2026-10`                                                                                   |

For `AUTH_EMAIL_ENCRYPTION_KEY`, use a password generator set to "hex", or run `openssl rand -hex 32` on any Mac or Linux computer. Keep a copy in your password manager: if it changes, queued emails can no longer be read.

The server does not start until `PAYMENTS_WEBHOOK_SECRET` is set, so do step 6 before the first deploy.

## 5. Your address for the server

1. In Brimble: **Domains → add** `api.acticlaim.com` to the project.
2. In Cloudflare DNS: add the record Brimble shows (usually a CNAME `api` → a Brimble address) with the cloud icon **grey** (DNS only), so Brimble can issue the HTTPS certificate.
3. Once it is live, `https://api.acticlaim.com/api/v1/health/live` should show `{"status":"ok"}`.

## 6. Bachs webhook

In the Bachs sandbox dashboard:

1. Add the webhook URL `https://api.acticlaim.com/api/v1/payments/webhooks/bachs` for collection and payout events. Bachs accepts it before the server is up.
2. Copy its signing secret into `PAYMENTS_WEBHOOK_SECRET` on Brimble.
3. Deploy.

## 7. Database setup and scheduled jobs (Brimble cron jobs)

Create three cron jobs on the server project:

| Name    | Command                                            | Schedule                        |
| ------- | -------------------------------------------------- | ------------------------------- |
| migrate | `node apps/api/dist/database/migrate-cli.js`       | `0 0 1 1 *` (only run by hand)  |
| emails  | `node apps/api/dist/auth/email-worker-cli.js`      | `* * * * *` (every minute)      |
| payouts | `node apps/api/dist/payments/payout-worker-cli.js` | `*/5 * * * *` (every 5 minutes) |

Then:

1. Open **migrate** and press **Run now**. The run history shows `Database migrations completed.` Run it again after every update.
2. Check that **emails** and **payouts** run, and that their history shows `auth_email_batch` and `payout_batch`.

If verification emails never arrive, check the Resend key and domain. With a wrong key the emails job shows `"dead"` and drops those emails; people can ask for a new one from the sign-in page.

## 8. The website (Vercel)

1. **Add New → Project** and import `Pointrush`.
2. **Root Directory**: `apps/web`. **Framework**: Next.js.
3. **Install Command**: `cd ../.. && npm ci`.
4. **Build Command**: `cd ../.. && npm run build --workspace @pointrush/contracts && npm run build --workspace @pointrush/web`.
5. **Node.js version**: 24.x (Settings → General).
6. **Environment variables**:
   - `NEXT_PUBLIC_API_ORIGIN` = `https://api.acticlaim.com`
   - `NEXT_PUBLIC_FEATURE_JOBS` = `off`
7. **Production branch**: `develop` (Settings → Git). Deploy.
8. **Settings → Domains**: add `acticlaim.com` and put the record Vercel shows into Cloudflare, with the cloud icon grey.

## 9. Make yourself the first reviewer

This needs a computer with Node.js 24 and Git. Use your own computer, or Google Cloud Shell (shell.cloud.google.com), which is free and needs no billing.

1. Sign up on your site with your own email and verify it.
2. In Supabase's **SQL editor**, find your account ID:

   ```sql
   select l.account_id, u.email from auth_account_links l join auth_users u on u.id = l.auth_user_id;
   ```

3. Run these, replacing `YOUR-ACCOUNT-ID`. Save `prod-ca-2021.crt` (the Supabase certificate) in the folder you start from.

   ```bash
   git clone https://github.com/ezekiel37/Pointrush.git && cd Pointrush && git checkout develop
   npm ci && npm run build --workspace @pointrush/contracts && npm run build --workspace @pointrush/api
   cd apps/api
   export DATABASE_CA_CERT="$(cat ../../../prod-ca-2021.crt)"
   read -rs REVIEWER_PROVISIONING_DATABASE_URL && export REVIEWER_PROVISIONING_DATABASE_URL   # paste the Supabase string
   export REVIEWER_OPERATOR_ACCOUNT_ID=YOUR-ACCOUNT-ID
   export REVIEWER_OPERATOR_TOKEN=$(openssl rand -hex 32)
   export REVIEWER_OPERATOR_TOKEN_SHA256=$(printf '%s' "$REVIEWER_OPERATOR_TOKEN" | sha256sum | cut -d' ' -f1)
   node dist/reviews/reviewer-provisioning-cli.js grant --grant-id $(cat /proc/sys/kernel/random/uuid) \
     --reviewer-id YOUR-ACCOUNT-ID --reason "Founder" --expires-at $(date -u -d '+29 days' +%Y-%m-%dT%H:%M:%SZ)
   ```

   On a Mac, use `shasum -a 256` instead of `sha256sum`, `uuidgen` for the grant ID, and `date -u -v+29d +%Y-%m-%dT%H:%M:%SZ` for the date.

4. On the site, turn on two-factor from your account page. Reviewer pages need it.

Reviewer access lasts at most 30 days; to renew, run the CLI's `revoke` and then `grant` again. Appoint a second trusted reviewer the same way: campaigns of ₦1,000,000 or more and unfreezing an account need two different people.

## 10. Test before inviting anyone

Run the whole flow on the live site:

- sign up and verify your email;
- create a business and fund it with Bachs sandbox;
- get the campaign approved, confirm a purchase at the till, release the cash back and withdraw;
- claim a prize code;
- void a purchase and dispute it.

The phone steps wait for the SMS connection.

## Updating later

1. Push to `develop`. Vercel redeploys the website by itself; on Brimble, redeploy the server (or turn on automatic deploys from `develop`).
2. Run the **migrate** cron job again (**Run now**) before using new features.

## Switching from sandbox to live keys

The same rule as LAUNCH.md, step 12: a database that ran on sandbox keys must never run on live keys. Create a new Supabase project (`acticlaim-live`), then on Brimble change `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `DATABASE_CA_CERT`, `BACHS_API_KEY` (`sk_live_…`) and `PAYMENTS_WEBHOOK_SECRET` (live webhook). Redeploy, run **migrate**, appoint reviewers again, and tell testers to sign up again. Before real money, also upgrade Supabase for daily backups.
