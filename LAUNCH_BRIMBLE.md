# Deploying Acticlaim on Brimble, step by step

A low-cost alternative to LAUNCH.md (Google Cloud), with no prepayment. The server and the website both run on Brimble (Vercel's free plan does not allow commercial use):

| Part                    | Where                                        | Cost                                         |
| ----------------------- | -------------------------------------------- | -------------------------------------------- |
| Server + scheduled jobs | Brimble (7-day Developer trial, then Hacker) | $0 for the trial week, then about $7 a month |
| Website                 | Brimble (a second app in the same project)   | About $2–4 a month                           |
| Database                | Supabase                                     | Free (no backups, pauses after a week idle)  |
| Email                   | Resend                                       | Free up to 3,000 a month                     |
| Domain and DNS          | Cloudflare                                   | About $10 a year                             |

The examples use `acticlaim.com`; replace it with your domain everywhere. Never put a key or password in Git or in a chat. Each secret goes only into Brimble's environment variable settings.

Brimble's screens may name things slightly differently from these steps. If a step does not match what you see, describe the screen to Claude (without keys).

## 1. Accounts

1. **Cloudflare**: buy the domain, or move it there.
2. **Supabase**: create a project named `acticlaim-test` in **Central EU (Frankfurt)** and save the database password.
3. **Brimble**: start the 7-day Developer trial. Check whether it charges automatically on day 7. Either way, switch to **Hacker** before the trial ends.
4. **Resend**: add the sending subdomain `mail.acticlaim.com` (Resend recommends a subdomain so the main domain's reputation is protected), copy the DNS records it shows into Cloudflare with the cloud icon grey, wait for Verified, and create an API key.
5. **Bachs**: in the sandbox, copy the API key (`sk_sandbox_…`). The webhook comes in step 6.
6. **SMS (Termii or Africa's Talking)**: request a sender ID now. Until Claude connects it, phone verification shows "not available yet", so withdrawals and prize claims wait.

## 2. Database details (Supabase)

1. Open **Connect** and copy the **Session pooler** connection string (port 5432). Put your password in place of `[YOUR-PASSWORD]`.
2. Under **Database settings → SSL**, download the certificate file and open it in a text editor. You will paste its whole text (from `-----BEGIN CERTIFICATE-----` to `-----END CERTIFICATE-----`) into Brimble.

## 3. Create the server on Brimble

1. **New project → Import from GitHub** and choose `Pointrush`, branch `develop`.
2. **Root directory**: `./`. **Framework**: Docker. Brimble builds the `Dockerfile` at the top of the repository, which is the server (a copy of `apps/api/Dockerfile`). Build, start, install and output fields are ignored.
   **Pre-start command**: `node apps/api/dist/database/migrate-cli.js` (sets up or updates the database every time the server starts).
   Keep the `PORT` secret Brimble adds; the server listens on it.
3. **Region: Germany.** It is close to the Supabase database, and every request makes several database trips.
4. **Size**: the smallest available (0.5–1 vCPU, 512 MB–1 GB memory) is enough. Use one instance; the Hacker plan has no autoscaling.
5. **Port**: 8080. **Health check path**: `/api/v1/health/live`.

## 4. Server settings (Brimble environment variables)

| Name                        | Value                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `NODE_ENV`                  | `production`                                                                                |
| `FEATURE_JOBS`              | `on`                                                                                        |
| `DATABASE_URL`              | The Supabase session pooler string                                                          |
| `MIGRATION_DATABASE_URL`    | The same string                                                                             |
| `DATABASE_CA_CERT`          | The certificate text. If the box takes only one line, join the lines with `\n` between them |
| `DATABASE_POOL_MAX`         | `3`                                                                                         |
| `CORS_ORIGINS`              | `https://acticlaim.com`                                                                     |
| `AUTH_BASE_URL`             | `https://api.acticlaim.com`                                                                 |
| `AUTH_TRUSTED_ORIGINS`      | `https://acticlaim.com`                                                                     |
| `AUTH_SECRET`               | A random 48-character string (a password manager can generate one)                          |
| `AUTH_EMAIL_ENCRYPTION_KEY` | Exactly 64 characters using only `0-9` and `a-f` (see below)                                |
| `EMAIL_FROM`                | `accounts@mail.acticlaim.com` (shown to people as "Acticlaim")                              |
| `RESEND_API_KEY`            | The Resend key                                                                              |
| `PAYMENTS_PROVIDER`         | `bachs`                                                                                     |
| `BACHS_API_KEY`             | `sk_sandbox_…`                                                                              |
| `PAYMENTS_WEBHOOK_SECRET`   | From step 6                                                                                 |
| `PAYMENTS_RETURN_ORIGIN`    | `https://acticlaim.com`                                                                     |
| `SPONSOR_TERMS_VERSION`     | `2026-10`                                                                                   |

For `AUTH_EMAIL_ENCRYPTION_KEY`, use a password generator set to "hex", or run `openssl rand -hex 32` on any Mac or Linux computer. Keep a copy in your password manager: if it changes, queued emails can no longer be read.

Bachs only accepts a webhook address that already answers, so the **first deploy leaves out** `PAYMENTS_PROVIDER`, `BACHS_API_KEY` and `PAYMENTS_WEBHOOK_SECRET` (the server then runs with payments off). They are added in step 6.

## 5. Your address for the server

1. In Brimble: **Domains → add** `api.acticlaim.com` to the project.
2. In Cloudflare DNS: add the record Brimble shows (usually a CNAME `api` → a Brimble address) with the cloud icon **grey** (DNS only), so Brimble can issue the HTTPS certificate.
3. Once it is live, `https://api.acticlaim.com/api/v1/health/live` should show `{"status":"ok"}`.

## 6. Bachs webhook

In the Bachs sandbox dashboard:

1. Once `https://api.acticlaim.com/api/v1/health/live` answers (step 5), add the webhook URL `https://api.acticlaim.com/api/v1/payments/webhooks/bachs` for `collection.succeeded`, `payout.paid` and `payout.failed` (or all events).
2. Copy its signing secret.
3. On Brimble, add `PAYMENTS_PROVIDER` = `bachs`, `BACHS_API_KEY` = `sk_sandbox_…` and `PAYMENTS_WEBHOOK_SECRET` = the signing secret, then redeploy.

If Bachs still says the URL cannot be reached while the health address works, tell Claude: the webhook address may need to answer Bachs's test differently.

## 7. Emails and payouts (no cron needed)

The server sends queued emails every 10 seconds and hands withdrawals to Bachs every minute by itself. Do not create Brimble cron jobs; if you created one, delete it (an extra run is harmless, but it is not needed).

Check it in the server's normal logs:

- After a sign-up, a line `auth_email_batch` with `"accepted"` means the email went to Resend.
- `"dead"` means Resend refused it: check `RESEND_API_KEY` and that `mail.acticlaim.com` is Verified in Resend.
- `email_sending_off` at startup means `RESEND_API_KEY` is missing.
- `payout_batch` appears only when a withdrawal was handed over (`"deferred"` above 0 needs a look, for example a low Bachs balance).

To run them as separate scheduled jobs instead, set `INLINE_WORKERS=off` and schedule `node apps/api/dist/auth/email-worker-cli.js` and `node apps/api/dist/payments/payout-worker-cli.js`.

## 8. The website (Brimble)

1. In the same Brimble project, add a **second app** from the same repository and branch (`develop`).
2. **Root directory**: `./`. **Framework**: not Docker (the top-level Dockerfile is the server). Choose **Next.js** or **Other** and set:
   - **Install command**: `npm ci`
   - **Build command**: `npm run build --workspace @pointrush/contracts && npm run build --workspace @pointrush/web`
   - **Start command**: `npm run start --workspace @pointrush/web`
   - **Output directory**: empty
3. **Region: Germany**, the smallest size, one instance. Keep the `PORT` secret Brimble adds.
4. **Secrets** (optional): `NEXT_PUBLIC_API_ORIGIN` = `https://api.acticlaim.com`. Without it, the site uses `api.` plus its own domain, which is the same thing. Jobs are on unless `NEXT_PUBLIC_FEATURE_JOBS` = `off`.

5. Deploy.
6. **Domains**: add `acticlaim.com` (and `www.acticlaim.com` if you want it) to this app, and put the records Brimble shows into Cloudflare, with the cloud icon grey.
7. Open `https://acticlaim.com`. The home page should load, and **Sign in** should reach the server without an error.

Changing `NEXT_PUBLIC_FEATURE_JOBS` later needs a new build (redeploy), not just a restart.

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
5. The same command also lets you decide **job appeals** (Review → Appeals) for the same 30 days, and `revoke` removes both. A business can never decide appeals on its own jobs.

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

1. Push to `develop`, then redeploy both apps on Brimble (or turn on automatic deploys from `develop`).
2. The database updates itself on start (pre-start command); check the log shows `Database migrations completed.`

## Switching from sandbox to live keys

The same rule as LAUNCH.md, step 12: a database that ran on sandbox keys must never run on live keys. Create a new Supabase project (`acticlaim-live`), then on Brimble change `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `DATABASE_CA_CERT`, `BACHS_API_KEY` (`sk_live_…`) and `PAYMENTS_WEBHOOK_SECRET` (live webhook). Redeploy, appoint reviewers again, and tell testers to sign up again. Before real money, also upgrade Supabase for daily backups.
