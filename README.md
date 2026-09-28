# PointRush

Production-oriented rewards platform for Nigeria. The product is under construction, not ready for public use or real funds.

## Current Slice

NestJS API and portable PostgreSQL foundation: versioned HTTP, liveness/readiness, strict configuration, security headers, request validation, safe errors, Drizzle migrations, account identity constraints, tests and CI. No signup/login, payment or reward endpoints are enabled. The Next.js PWA will be added as its own feature slice.

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

Cloud Run plus managed services is the agreed hosting direction. Deployment is not configured yet: select region, project, service account, Secret Manager bindings, instance limits, budgets/alerts, database capacity and connection limits before enabling delivery. No infrastructure has been provisioned by this commit. Reward backing and operating costs are separate budgets.

## Feature Delivery

Use a focused `feat/*` or `fix/*` branch for each independently testable change. Run `npm run check` and the relevant integration suite, inspect the staged diff, commit and push the branch. Database changes require `npm run test:db` against native PostgreSQL. Merge after CI passes; never combine unfinished money flows with an unrelated working feature. Keep secrets and generated builds out of Git. Apply compatible database migrations in their owning feature commits. Dependent PRs may target the preceding feature branch while its checks are blocked; merge in dependency order.

Planned order:

1. API foundation and automated checks (implemented).
2. Portable PostgreSQL schema and migrations (implemented; native integration verification pending).
3. Accounts, authentication, recovery, permissions and audit trail.
4. Next.js application shell and account journeys.
5. Sponsor funding ledger, task allocation locks and reconciliation.
6. Task review, participation models, proof, appeals and reward accounting.
7. Redemptions, notifications, support and operational controls.
8. Claim codes, reputation, referrals, promotions and analytics.

These are implementation slices of the full product, not a reduced launch scope. Unresolved launch rules stay disabled rather than silently becoming defaults. All business endpoints require authorization, rate limits and feature-specific abuse tests before release; CORS is not authorization. Cookie credentials and CSRF policy will be configured with authentication, not assumed here.

## Product Contracts

- [PRD](PointRush_PRD.md)
- [Validation and approvals](PointRush_Validation_Approval_Rules.md)
- [Testing and engineering rules](PointRush_Testing_Risk_Engineering_Rules.md)
- [Design](DESIGN.md)
- [UX](UX-CONTRACT.md)

Implementation references: [NestJS validation](https://docs.nestjs.com/techniques/validation), [Cloud Run container contract](https://docs.cloud.google.com/run/docs/container-contract).
