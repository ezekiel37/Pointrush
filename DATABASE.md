# PostgreSQL Foundation

## Decision and Scope

Use Drizzle ORM with the standard `pg` driver. Schema definitions live in `apps/api/src/database/schema.ts`; reviewed, versioned SQL lives in `apps/api/migrations`. No Supabase-specific schemas, auth IDs, functions or extensions are required. Managed PostgreSQL remains the production target; no database provider has been provisioned.

This feature adds account IDs, access states, a shared current/historical/reserved username namespace, and verified phone ownership. It does not implement authentication, profile validation, identity verification, username-change APIs, rewards or balances. Those features must enforce their own domain rules and permissions. Do not infer identity or reputation from the presence of an account row.

| Invariant                   | Database enforcement                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| Stable identity             | UUID account primary key; relationships use IDs                                                       |
| Canonical usernames         | 3-20 lowercase ASCII characters, letter first, alphanumeric last, no consecutive underscores          |
| Unique username             | Primary key spans current, retired and platform-reserved names                                        |
| One current username        | Partial unique account index                                                                          |
| Retired names stay reserved | Immutable ownership/name/claim timestamp; trigger rejects deletion and reactivation                   |
| Verified phone ownership    | One phone per account; globally unique canonical number; required verification timestamp              |
| No pending-number squatting | Only completed verification belongs in `verified_phones`; future challenges must use separate records |
| Referential integrity       | Foreign keys prevent orphaned identities and accidental deletion of referenced accounts               |

The E.164 database check validates storage shape and maximum length only. The authentication feature must use maintained country/type metadata, verify channel ownership, and normalize before insertion. Username availability remains advisory; catch uniqueness conflicts at commit. The 30-day username-change cooldown and email identity policy belong to the upcoming account feature. They are not yet implemented.

## Local Setup

Docker Compose runs a development PostgreSQL 17 service on loopback with a persistent named volume. Its credentials are development-only. With the values from `apps/api/.env.example` in your local environment:

```sh
docker compose up -d --wait
npm ci
npm run build
npm run db:migrate
npm run dev:api
```

The API and migration commands load `apps/api/.env` when present. The migration command requires `MIGRATION_DATABASE_URL`; it intentionally does not fall back to the runtime URL. Use `DATABASE_SSL_MODE=disable-local` only for explicit loopback connections. Remote URLs must validate TLS certificates. Optional `sslmode=verify-full` is accepted and normalized; other URL options are rejected so driver parsing cannot override TLS policy. Add provider-specific CA support through an explicit reviewed change if needed; never use `rejectUnauthorized: false`.

## Migration Delivery

1. Edit the Drizzle schema and run `npm run db:generate`. Add custom migrations through `npm run db:generate --workspace @pointrush/api -- --custom --name=description` for triggers or data changes.
2. Review SQL, indexes, foreign keys, defaults, nullable transitions and lock impact. Generated SQL is not automatically safe to deploy.
3. Run embedded and native database tests. Commit SQL, schema and migration snapshots together. Never edit an applied migration; add a new corrective migration.
4. Run the built migration CLI once using a direct PostgreSQL connection and a migration role, before starting the new API revision. A transaction-pooling connection is not suitable for the session advisory lock.
5. Release the API only after migrations succeed. Validate readiness and retain the prior compatible revision for application rollback.

```sh
# Container release job, using Secret Manager-provided environment variables:
node apps/api/dist/database/migrate-cli.js
```

The CLI uses Drizzle's migrator, a direct-session advisory lock and a preflight comparison of applied migration hashes/timestamps against the checked-in history. Concurrent runners fail instead of applying changes twice. Drizzle transactions roll back failed domain DDL; the migration metadata schema/table may remain. Closing the migration connection releases the lock on failure. Statement and lock timeouts bound migration work; plan large backfills separately.

Use additive changes followed by backfill, rollout and later removal. No automatic destructive `down` migrations or runtime schema synchronization. Restore/backups and incident procedures must be verified with the chosen provider before real accounts or money go live.

## Connections and Access

- `DATABASE_POOL_MAX` defaults to 5 connections per API instance and accepts 1-20. One pool is created per Nest module instance and closed on application shutdown.
- Connection acquisition times out after 3 seconds; SQL execution after 5 seconds; client query waiting after 6 seconds. Idle transactions are terminated after 5 seconds. Idle connections expire after 30 seconds.
- Size Cloud Run maximum instances and worker pools together: maximum API instances multiplied by the pool limit, plus workers, migrations and operational headroom must fit the provider's connection budget. These defaults do not by themselves cap total cloud spending.
- Give the API role only required table operations, not schema ownership, role creation, DDL or unrestricted grants. Keep migration credentials out of the API service's environment. Provision these roles with the selected provider before deployment.
- The initial API role needs schema usage and SELECT for readiness; grant INSERT/UPDATE to the owning application features when enabled. Do not grant TRUNCATE, which would bypass row-level reservation triggers.
- PostgreSQL is accessed only by the backend. There are no direct browser database credentials or public identity CRUD endpoints. Authorization is still required in every future repository caller; connection pooling is not tenant isolation.

## Health and Testing

`/api/v1/health/live` checks the running process. `/api/v1/health/ready` performs a bounded query against all three initial tables without reading personal rows. Missing schema, unavailable database, exhausted pool or insufficient read permissions return 503 without connection details. This checks the initial schema only; extend readiness when later features introduce new required schema. Use liveness for process restart probes so a database outage does not cause a restart loop.

```sh
npm run check
TEST_DATABASE_URL=postgresql://pointrush:pointrush_local@127.0.0.1:5432/postgres DATABASE_SSL_MODE=disable-local npm run test:db
```

The standard suite runs PGlite, an embedded PostgreSQL engine, to validate checked-in SQL, constraints, reservation triggers and rollback. It does not prove network, pool, TLS or multi-session locking behaviour.

The native suite creates a unique temporary database through `TEST_DATABASE_URL`, applies real migrations, tests competing username/phone claims, migration locks/history drift, readiness recovery and pool exhaustion, then drops only its temporary database. The supplied test role needs CREATEDB. Missing test configuration fails explicitly rather than silently skipping. Use disposable test infrastructure, never production credentials.

Native PostgreSQL and container checks are configured in GitHub CI. They were not run in the current workspace: native PostgreSQL startup needs non-root process permissions that are blocked, Docker is unavailable, and GitHub Actions has an account billing lock. Passing embedded tests is not a substitute for those release gates.

References: [Drizzle migrations](https://orm.drizzle.team/docs/migrations), [node-postgres pooling](https://node-postgres.com/features/pooling), [node-postgres TLS](https://node-postgres.com/features/ssl).
