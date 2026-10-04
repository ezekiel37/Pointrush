# PointRush

Production-oriented rewards platform for Nigeria. The product is under construction, not ready for public use or real funds.

## Current Slice

NestJS API with portable PostgreSQL, account management, verified-email authentication, sessions, recovery and authenticated onboarding. Auth routes mount when the complete auth configuration is provided; development without it retains public health checks and denies protected requests. No payment or reward endpoints exist yet. See [account boundaries and rules](ACCOUNTS.md) and [authentication implementation and release gates](AUTH.md). The Next.js account shell now connects to this API; see [web setup and browser verification](WEB.md). PWA/offline/push remain separate work.

## Local Development

Use Node.js 24 and npm (see `.nvmrc`). From the repository root:

```sh
npm ci
npm run check
npm run dev:api
```

API: `http://localhost:8080/api/v1/health/live`. Environment variables are documented in `apps/api/.env.example`; the development command loads an optional `apps/api/.env`. Real secrets must never be committed.

Without database configuration, development liveness works but `/api/v1/health/ready` returns 503. Production requires `DATABASE_URL`. See [database setup and migration operations](DATABASE.md) for local PostgreSQL, TLS, connection limits and native database testing.

```sh
npm run build
npm start --workspace @pointrush/api
```

## Cloud Run Target

```sh
docker build -f apps/api/Dockerfile -t pointrush-api .
docker run --rm -p 8080:8080 -e DATABASE_URL -e CORS_ORIGINS=https://your-frontend.example pointrush-api
```

The non-root container listens on `0.0.0.0:$PORT`, writes JSON Nest logs to standard output, and handles termination signals. Configure an exact HTTPS frontend origin and database connection before production startup. `/api/v1/health/live` proves process liveness; `/api/v1/health/ready` additionally checks database connectivity and the initial schema. Neither claims that payment or reward providers are ready. Migrations run as a separate job before release, never on every API instance.

The agreed validation stack is Vercel/Next.js, Cloud Run/NestJS and Supabase Free PostgreSQL, retaining Better Auth and Drizzle. Cloudflare provides DNS, appropriate API protection, R2 storage and Turnstile; PostgreSQL notifications with FCM and Resend delivery follow in their feature slices. See [infrastructure decisions, costs and release gaps](INFRASTRUCTURE.md). These choices are not deployed integrations. Start with recurring free allowances, zero minimum API instances and bounded scaling; trial credits are optional temporary buffers. Configure regions, secrets, connection budgets, authenticated job execution and restore-tested backups before release. Reward backing and operating costs remain separate budgets.

## Feature Delivery

Read [HANDOFF.md](HANDOFF.md) for current progress, verification gaps and the next task when resuming work.

Authentication email is now queued durably; see [worker setup and queue operations](EMAIL_QUEUE.md). Production auth requires `AUTH_EMAIL_ENCRYPTION_KEY` and a separately invoked worker before users can receive mail. No mail worker has been deployed yet.

Continue on the shared `develop` branch with focused, independently testable atomic commits. Do not create a branch or PR per feature. The repository owner will merge the existing feature branches/PRs. Run `npm run check` and the relevant integration suite, inspect the staged diff, commit and push `develop` without force. Database changes require `npm run test:db` against native PostgreSQL. Run checks locally and record any unverified release gates; do not create or modify CI workflows. Keep secrets and generated builds out of Git. Apply compatible database migrations in their owning feature commits.

Planned order:

1. API foundation and automated checks (implemented).
2. Portable PostgreSQL schema and migrations (implemented; native integration verification pending).
3. Internal account creation and username lifecycle (implemented); authentication foundation, authenticated account onboarding and private account-status reads are implemented, while permissions and the full audit trail follow.
4. Next.js application shell and account journeys (implemented; production browser and delivery gates pending).
5. Sponsor funding ledger, task allocation locks and reconciliation.
6. Task review, participation models, proof, appeals and reward accounting.
7. Redemptions, notifications, support and operational controls.
8. Claim codes, reputation, referrals, promotions and analytics.

These are implementation slices of the full product, not a reduced launch scope. Unresolved launch rules stay disabled rather than silently becoming defaults. All business endpoints require authorization, rate limits and feature-specific abuse tests before release; CORS is not authorization. Cookie credentials and CSRF policy will be configured with authentication, not assumed here.

## Product Contracts

- [Current product direction](PRODUCT.md)
- [PRD](PointRush_PRD.md)
- [Validation and approvals](PointRush_Validation_Approval_Rules.md)
- [Testing and engineering rules](PointRush_Testing_Risk_Engineering_Rules.md)
- [Design](DESIGN.md)
- [UX](UX-CONTRACT.md)

Implementation references: [NestJS validation](https://docs.nestjs.com/techniques/validation), [Cloud Run container contract](https://docs.cloud.google.com/run/docs/container-contract).
