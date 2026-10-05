# Deploying Acticlaim, step by step

Launch scope: cash back offers, prize codes and vouchers, wallet, profiles and reviewer tools. Paid small tasks (jobs) are switched off. Start on Bachs sandbox keys and switch to live keys later (step 12).

The examples use `acticlaim.com`; replace it with your domain everywhere. Never put a key or password in Git or in a chat. Each secret goes into Google Secret Manager or Vercel only.

Run every command in **Google Cloud Shell** (the `>_` button at the top of console.cloud.google.com). It already has `gcloud`, `git` and `openssl`, so nothing needs installing on your computer.

## 1. Create the accounts

1. **Cloudflare**: buy the domain, or move it to Cloudflare.
2. **Supabase**: create a project named `acticlaim-test`, in a European region (London or Frankfurt), and save the database password.
3. **Google Cloud**: create a project, add billing, and set a budget alert (Billing → Budgets, for example $20 a month).
4. **Vercel**: sign up with the GitHub account that owns `ezekiel37/Pointrush`.
5. **Resend**: add your domain and copy the DNS records it shows into Cloudflare. Create an API key (sending access).
6. **Bachs**: in the sandbox, copy the API key (`sk_sandbox_…`).
7. **SMS (Termii or Africa's Talking)**: request a sender ID now, because approval takes days. The connection to it is not built yet, so tell Claude which one you chose. Until then, phone verification shows "not available yet", so nobody can withdraw or claim prizes.

## 2. Get the database details (Supabase)

1. Open **Connect** and copy the **Session pooler** connection string (port 5432). It looks like `postgresql://postgres.abcd:[YOUR-PASSWORD]@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`. Put your password in place of `[YOUR-PASSWORD]`.
2. Under **Database settings → SSL**, download the certificate file (for example `prod-ca-2021.crt`).

Use the session pooler, not the direct connection: Google Cloud cannot reach the direct one.

## 3. Prepare Google Cloud (Cloud Shell)

```bash
export PROJECT_ID=your-project-id
export REGION=europe-west1
gcloud config set project $PROJECT_ID
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com
gcloud artifacts repositories create acticlaim --repository-format=docker --location=$REGION
git clone https://github.com/ezekiel37/Pointrush.git && cd Pointrush && git checkout develop
```

## 4. Store the secrets

Upload the Supabase certificate file into Cloud Shell (the ⋮ menu → Upload), then run the commands below. For each `read -rs V` line, paste the value and press Enter; nothing shows on screen, which is intended.

```bash
gcloud secrets create database-ca --data-file=$HOME/prod-ca-2021.crt
read -rs V && printf '%s' "$V" | gcloud secrets create database-url --data-file=-    # Supabase session pooler string
read -rs V && printf '%s' "$V" | gcloud secrets create bachs-key --data-file=-       # sk_sandbox_…
read -rs V && printf '%s' "$V" | gcloud secrets create resend-key --data-file=-      # Resend API key
openssl rand -base64 36 | tr -d '\n' | gcloud secrets create auth-secret --data-file=-
openssl rand -hex 32 | tr -d '\n' | gcloud secrets create email-key --data-file=-
export PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

The Bachs webhook secret comes in step 8; create it then.

## 5. Build the server

```bash
export IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/acticlaim/api:v1
gcloud builds submit --config apps/api/cloudbuild.yaml --substitutions=_IMAGE=$IMAGE .
```

If it stops with "permission denied", copy the message to Claude.

## 6. Set up the database

```bash
gcloud run jobs create acticlaim-migrate --image $IMAGE --region $REGION \
  --command node --args apps/api/dist/database/migrate-cli.js --max-retries 0 \
  --set-env-vars NODE_ENV=production \
  --set-secrets MIGRATION_DATABASE_URL=database-url:latest,DATABASE_CA_CERT=database-ca:latest
gcloud run jobs execute acticlaim-migrate --region $REGION --wait
```

The last line ends in "completed successfully". Run it again after every update (step 11).

## 7. Start the server

```bash
export ENV_VARS="NODE_ENV=production,FEATURE_JOBS=off,DATABASE_POOL_MAX=3,CORS_ORIGINS=https://acticlaim.com,AUTH_BASE_URL=https://api.acticlaim.com,AUTH_TRUSTED_ORIGINS=https://acticlaim.com,EMAIL_FROM=accounts@acticlaim.com,PAYMENTS_PROVIDER=bachs,PAYMENTS_RETURN_ORIGIN=https://acticlaim.com,SPONSOR_TERMS_VERSION=2026-10"
export SECRETS="DATABASE_URL=database-url:latest,DATABASE_CA_CERT=database-ca:latest,AUTH_SECRET=auth-secret:latest,AUTH_EMAIL_ENCRYPTION_KEY=email-key:latest,BACHS_API_KEY=bachs-key:latest,PAYMENTS_WEBHOOK_SECRET=bachs-webhook:latest"
```

Before deploying, create the Bachs webhook (step 8). Then:

```bash
gcloud run deploy acticlaim-api --image $IMAGE --region $REGION --allow-unauthenticated \
  --min-instances 0 --max-instances 3 --set-env-vars "$ENV_VARS" --set-secrets "$SECRETS"
```

**Connect the address:**

1. Verify the domain once: run `gcloud domains verify acticlaim.com` and follow the link.
2. Map it to the server: `gcloud beta run domain-mappings create --service acticlaim-api --domain api.acticlaim.com --region $REGION`.
3. In Cloudflare DNS, add the record it prints (a CNAME `api` → `ghs.googlehosted.com`) with the cloud icon **grey** (DNS only).
4. After 15–60 minutes, `https://api.acticlaim.com/api/v1/health/live` should answer.

## 8. Bachs webhook

In the Bachs sandbox dashboard:

1. Add the webhook URL `https://api.acticlaim.com/api/v1/payments/webhooks/bachs` for collection and payout events.
2. Copy its signing secret into Secret Manager:

```bash
read -rs V && printf '%s' "$V" | gcloud secrets create bachs-webhook --data-file=-
```

## 9. Scheduled jobs

```bash
gcloud run jobs create acticlaim-email --image $IMAGE --region $REGION \
  --command node --args apps/api/dist/auth/email-worker-cli.js --max-retries 0 \
  --set-env-vars NODE_ENV=production \
  --set-secrets DATABASE_URL=database-url:latest,DATABASE_CA_CERT=database-ca:latest,RESEND_API_KEY=resend-key:latest,AUTH_EMAIL_ENCRYPTION_KEY=email-key:latest
gcloud run jobs create acticlaim-payouts --image $IMAGE --region $REGION \
  --command node --args apps/api/dist/payments/payout-worker-cli.js --max-retries 0 \
  --set-env-vars "$ENV_VARS" --set-secrets "$SECRETS"
gcloud iam service-accounts create acticlaim-scheduler
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:acticlaim-scheduler@$PROJECT_ID.iam.gserviceaccount.com --role=roles/run.invoker
for JOB in acticlaim-email:"* * * * *" acticlaim-payouts:"*/5 * * * *"; do
  NAME=${JOB%%:*}; SCHEDULE=${JOB#*:}
  gcloud scheduler jobs create http $NAME-schedule --location $REGION --schedule "$SCHEDULE" \
    --uri "https://$REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$PROJECT_ID/jobs/$NAME:run" \
    --http-method POST \
    --oauth-service-account-email acticlaim-scheduler@$PROJECT_ID.iam.gserviceaccount.com
done
```

Emails go out every minute and payouts every 5 minutes. A payouts run that ends with code 2 means a payout was delayed; check the Bachs dashboard.

## 10. The website (Vercel)

1. **Add New → Project** and import `Pointrush`.
2. Set **Root Directory** to `apps/web` and **Framework** to Next.js.
3. Set **Install Command** to `cd ../.. && npm ci`.
4. Set **Build Command** to `cd ../.. && npm run build --workspace @pointrush/contracts && npm run build --workspace @pointrush/web`.
5. Set **Node.js version** to 24.x (Settings → General).
6. Add these environment variables:
   - `NEXT_PUBLIC_API_ORIGIN` = `https://api.acticlaim.com`
   - `NEXT_PUBLIC_FEATURE_JOBS` = `off`
7. Set the production branch to `develop` (Settings → Git), then deploy.
8. **Settings → Domains**: add `acticlaim.com` and put the record Vercel shows into Cloudflare, again with the cloud icon grey.

## 11. Before inviting anyone

**Make yourself the first reviewer.**

1. Sign up on the site with your own email and verify it.
2. In Supabase's **SQL editor**, find your account ID:

   ```sql
   select l.account_id, u.email from auth_account_links l join auth_users u on u.id = l.auth_user_id;
   ```

3. In Cloud Shell, run the commands below. Use `nvm install 24` first if `node -v` shows an older version.

```bash
cd ~/Pointrush && npm ci && npm run build --workspace @pointrush/contracts && npm run build --workspace @pointrush/api
cd apps/api
export DATABASE_CA_CERT="$(cat $HOME/prod-ca-2021.crt)"
read -rs REVIEWER_PROVISIONING_DATABASE_URL && export REVIEWER_PROVISIONING_DATABASE_URL   # same Supabase string
export REVIEWER_OPERATOR_ACCOUNT_ID=YOUR-ACCOUNT-ID
export REVIEWER_OPERATOR_TOKEN=$(openssl rand -hex 32)
export REVIEWER_OPERATOR_TOKEN_SHA256=$(printf '%s' "$REVIEWER_OPERATOR_TOKEN" | sha256sum | cut -d' ' -f1)
node dist/reviews/reviewer-provisioning-cli.js grant --grant-id $(cat /proc/sys/kernel/random/uuid) \
  --reviewer-id YOUR-ACCOUNT-ID --reason "Founder" --expires-at $(date -u -d '+29 days' +%Y-%m-%dT%H:%M:%SZ)
```

4. On the site, turn on two-factor from your account page. Reviewer pages need it.

Reviewer access lasts at most 30 days. To renew, run the CLI's `revoke` and then `grant` again. Also appoint a second trusted reviewer the same way: campaigns of ₦1,000,000 or more and unfreezing an account need two different people.

**Then:**

1. **Backups**: the free Supabase plan has none. Upgrade, or ask Claude for a daily backup job.
2. **Test the whole flow on the live site:**
   - sign up and verify your email;
   - create a business and fund it with Bachs sandbox;
   - get the campaign approved, confirm a purchase at the till, release the cash back and withdraw;
   - claim a prize code;
   - void a purchase and dispute it.

   Phone steps wait for the SMS connection.

3. **Cloudflare rate limits**: set a rate-limit rule on `api.acticlaim.com`. This needs the cloud icon orange, so do it once the certificate is issued.

**Updating later.** Use a new tag each time (`v2`, `v3`, …):

```bash
cd ~/Pointrush && git pull
export IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/acticlaim/api:v2
gcloud builds submit --config apps/api/cloudbuild.yaml --substitutions=_IMAGE=$IMAGE .
for J in acticlaim-migrate acticlaim-email acticlaim-payouts; do gcloud run jobs update $J --image $IMAGE --region $REGION; done
gcloud run jobs execute acticlaim-migrate --region $REGION --wait
gcloud run deploy acticlaim-api --image $IMAGE --region $REGION
```

Vercel redeploys the website by itself when `develop` changes.

## 12. Switching from sandbox to live keys

The code does not change; the keys and the database do. Money recorded on the sandbox never reached the Bachs balance, and bank accounts saved there exist only in the sandbox. A database that ran on sandbox keys must never run on live keys, and its money records cannot be cleaned out row by row (they are append-only by design).

1. Create a new Supabase project `acticlaim-live` and download its certificate.
2. Add new versions of the secrets: `gcloud secrets versions add database-url --data-file=-` (likewise `database-ca`, `bachs-key` with `sk_live_…`, and `bachs-webhook` with the live webhook's secret). Add the live webhook URL in the Bachs live dashboard.
3. Run step 6 (database setup), then redeploy: `gcloud run deploy acticlaim-api --image $IMAGE --region $REGION`. The jobs pick up the new secrets on their next run.
4. Appoint reviewers again (step 11), and tell testers to sign up again.

## Open risks

- No lawyer's opinion yet on the money model (SECURITY_REVIEW.md, C2).
- No written approval of the model from Bachs yet.
- No daily check that the Bachs balance covers what Acticlaim owes (M3).
- Someone must be on duty for void disputes and flagged payments.
- The server and jobs connect as the database owner (`postgres`). Separate, narrower database users are a later hardening step (DATABASE.md).
