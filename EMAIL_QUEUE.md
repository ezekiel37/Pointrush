# Authentication email queue

Authentication emails are persisted before delivery. The API writes encrypted jobs in PostgreSQL and a separate finite worker batch sends them through Resend. No worker service, cloud schedule or provider account has been deployed by this change.

## Atomicity and failure behaviour

Signup writes its user, credential and verification email job in the same Better Auth transaction. The queue callback uses the active adapter; it does not open another connection inside signup. A queue insert failure rolls signup back and returns a safe 503. A small pinned Better Auth plugin makes callback failures propagate because the library's default background helper swallows them. Do not add a background task handler or change this integration without rerunning the rollback test.

Password-reset token creation and its queue write follow the library's sequential flow. If the queue write fails, the request fails; an unused reset token can remain until expiry. It creates no session. Request again after the email cooldown. Known and unknown addresses undergo the same quota and queue-table availability checks before lookup. Provider outages no longer affect public request responses because provider calls run in the worker. A row-specific queue write failure can still differ from an unknown-account response; timing and storage-error enumeration hardening remain release checks.

Quota is reserved once before the auth operation; worker retries do not reserve again. Quota reservations are conservative and are not refunded after failed operations or crashes. They limit requests, not individual HTTP attempts against Resend.

## Storage and secrets

Set `AUTH_EMAIL_ENCRYPTION_KEY` to a separately generated random 32-byte key encoded as 64 hex characters, delivered through Secret Manager to both API and worker. Do not reuse the auth signing secret. Startup rejects malformed or absent queue keys when auth is enabled.

Recipient, sender, subject and email text (including the secret link) are encrypted together with AES-256-GCM using Node's standard crypto implementation. Each encryption uses a fresh 12-byte nonce and a 16-byte authentication tag; authenticated context binds the ciphertext to the job ID. Plaintext addresses and links are never stored in the jobs table or logged. The snapshot preserves the exact sender and content across template changes and deployments.

There is no automatic key rotation/keyring yet. Drain active jobs before changing the key. If a worker has the wrong key, it marks the job dead without sending and preserves ciphertext until expiry. Restore the matching key, inspect the exact job, and requeue only if it is unexpired and below five attempts; preserve its ID and payload. Never reset its deadline or mint a replacement idempotency key to force a resend. Lost keys cannot be recovered from database backups alone.

## Worker execution

Apply migrations first, configure the environment, then run:

```sh
npm run build
npm run email:work --workspace @pointrush/api
```

The command processes at most 25 eligible jobs, performs retention cleanup and exits. It uses the runtime database credentials, not the migration/admin role. It prints only aggregate outcome counts. It does not run migrations or start a timer inside the API process. Deployment must arrange authenticated worker invocation and retry wakeups while the API is accepting signups; without a running worker emails remain queued. External invocation/monitoring configuration is still pending billing and deployment setup.

The [agreed infrastructure](INFRASTRUCTURE.md) retains this queue on Supabase PostgreSQL and targets authenticated scheduled execution on Cloud Run. Scheduling is not implemented. Evaluate a cooperatively bounded HTTP runner versus the existing CLI for job execution; account for scheduler/compute charges. Do not use post-response fire-and-forget or assume a timer can wake a scaled-to-zero service. Reserve authentication/recovery capacity before adding welcome or promotional mail.

EMAIL_WORKER_MAX_DURATION_MS defaults to 60000 and accepts 1000-300000 milliseconds. A CLI-only watchdog starts after configuration validation and covers database connection waits, delivery, pruning and pool shutdown. On expiry it emits only auth_email_batch_deadline and exits with status 1. An in-flight job can remain leased and a send may have an uncertain outcome; a later invocation recovers expired leases with the original payload and provider idempotency key. Never create a new job/key to retry interrupted work. Very short budgets can repeatedly interrupt jobs; tune using measured delivery times. The timer relies on a responsive Node event loop; configure a longer external process timeout as a backstop. This process-exit watchdog must not be reused inside a shared HTTP API.

The worker requires only DATABASE_URL, TLS/pool settings, AUTH_EMAIL_ENCRYPTION_KEY and RESEND_API_KEY, plus its optional duration setting. It does not require AUTH_SECRET, EMAIL_FROM, PORT, browser origins or migration credentials: sender/content are already encrypted in each job. The API no longer requires RESEND_API_KEY. Provision separate environments in production; loading the combined local .env file is only a development convenience.

Workers claim rows with `FOR UPDATE SKIP LOCKED`, commit a 60-second lease, then release the database transaction before contacting Resend. Every acknowledgement and retry update checks the current lease token and its deadline. A stale worker cannot overwrite a replacement worker's state. A restart can reclaim an expired lease.

Each job has a stable Resend idempotency key derived from its UUID, reused for every transport attempt and worker retry. This addresses the provider-accepted/process-crashed-before-acknowledgement case within the provider's retention window; it is not a promise of exactly-once inbox delivery.

## Limits and retention

- Job lifetime: 20 minutes, shorter than reset links (30 minutes) and verification links (60 minutes). Worker eligibility uses database time and leaves 15 seconds before expiry for bounded transport. Keep API/database clocks synchronized.
- Maximum five reserved delivery attempts per job. Each attempt has at most two provider requests, each with a five-second abort timeout. An exhausted job becomes dead.
- Retry delays start at 60 seconds and double. Provider backoff is respected; a retry delayed past the job deadline expires instead of sending an old link.
- Authentication/validation provider failures are terminal. Rate limits, server failures, transport ambiguity and a provider report of an in-progress idempotent request are retryable.
- Accepted, expired and ordinary dead jobs have their encrypted payload cleared. Decryption-failed jobs retain ciphertext only until expiry for key repair. Terminal metadata is deleted after seven days when the worker runs cleanup. Backups have their own retention policy.
- `accepted` means Resend accepted the API request. Delivery/bounce webhooks and inbox-delivery status are not implemented.

## Verification and release gates

Local tests exercise real Better Auth signup transactions and queued reset requests, authenticated encryption, database rollback, immutable retry payloads, lease recovery, stale acknowledgements, expiry, retry exhaustion and cleanup using PGlite. Native PostgreSQL competing-worker tests are checked in but have not been run here. No test sends live email.

Before launch: run native concurrency tests, configure the worker invocation and alerts for queue age/dead jobs, verify Resend sender credentials and actual email delivery, test browser flows end to end, and settle key rotation and database backup retention. This feature provides durable queue code, not a deployed mail service.
