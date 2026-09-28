# infra

Local infrastructure for development (CLAUDE.md D7). Terraform for AWS arrives in Phase 6.

## Docker Compose: Redis 7 and PostgreSQL 16

`npm run infra:up` starts both and waits for their health checks; `npm run infra:down` stops them.
Both ports are bound to `127.0.0.1` only.

## PostgreSQL 16

`docker-compose.yml` runs `postgres:16-alpine` on `127.0.0.1:5432` with database `nthstock` in the
named volume `postgres-data`, so data survives `infra:down`. On the first start of an empty volume,
[`postgres/init.sql`](./postgres/init.sql) creates three roles (ADR 0007):

| Role | Used for | May |
| --- | --- | --- |
| `nthstock_owner` | migrations (`DATABASE_MIGRATION_URL`) | own and change the schema |
| `nthstock_app` | apps/api (`DATABASE_URL`) | read and write rows; no DDL, no temp tables |
| `nthstock_purge` | the account purge job | like the app role, plus deleting ledger rows (later migration) |

The passwords (`nthstock_app_dev` and so on, superuser `postgres_dev`) are non-secret local values,
also in `apps/api/.env.example`. Never reuse them anywhere else.

```bash
npm run infra:up
psql postgres://nthstock_app:nthstock_app_dev@127.0.0.1:5432/nthstock -c 'select 1'   # works
psql postgres://nthstock_app:nthstock_app_dev@127.0.0.1:5432/nthstock -c 'create table t (id int)'
# ERROR:  permission denied for schema public
docker compose -f infra/docker-compose.yml down -v   # delete the volume: an empty database next time
```

`init.sql` runs only on an empty volume. After changing it, reset the volume as above.

## PgBouncer (optional, profile `pool`)

Production (Phase 6) puts PgBouncer in **transaction mode** between apps/api and Postgres
(CLAUDE.md §4, ADR 0007): a server connection goes back to the pool after every transaction and
the next transaction may belong to another client. apps/api must work unchanged through it.

### PgBouncer rules

1. **Unnamed statements only.** Drizzle with `pg` sends unnamed statements; never call Drizzle's
   `.prepare()` or SQL `PREPARE` (`max_prepared_statements = 0` here).
2. **`SET LOCAL` only.** No `SET`, `SET SESSION` or `RESET` outside a transaction; use `SET LOCAL`
   or `set_config(name, value, true)` inside one (`Database.transaction` sets `statement_timeout`
   this way).
3. **No `LISTEN`/`NOTIFY`** (or `pg_notify`). Cross-process events go over Redis pub/sub.
4. **No session advisory locks** (`pg_advisory_lock`, `pg_try_advisory_lock`); use
   `pg_advisory_xact_lock` or row locks inside a transaction.
5. **No temp tables** (the app role cannot create them anyway).

`apps/api/src/db/pgbouncerRules.test.ts` greps every non-test file in `apps/api/src` for these
forms on every `npm run test`.

### Running through PgBouncer locally

[`pgbouncer/pgbouncer.ini`](./pgbouncer/pgbouncer.ini) listens on `127.0.0.1:6432`, forwards every
database to the compose Postgres, and authenticates `nthstock_app` and `nthstock_purge` from the dev
`pgbouncer/userlist.txt`. The owner and superuser connect to Postgres directly.

```bash
docker compose -f infra/docker-compose.yml --profile pool up -d --wait
# apps/api through the pooler
DATABASE_URL=postgres://nthstock_app:nthstock_app_dev@127.0.0.1:6432/nthstock npm run dev:api
# the integration suite: setup and migrations direct, app-role connections through the pooler
POSTGRES_TEST_URL=postgres://postgres:postgres_dev@127.0.0.1:5432/postgres \
POSTGRES_TEST_POOLER_URL=postgres://127.0.0.1:6432 npm run test -w @nthstock/api
docker compose -f infra/docker-compose.yml --profile pool down   # stops PgBouncer too
```

## Redis 7 (Docker Compose)

`docker-compose.yml` runs Redis 7 on `127.0.0.1:6379` with no password and no persistence. It
carries live ticks from `apps/api` to `apps/realtime` over pub/sub (ADR 0004 §4).

Requires Docker with the Compose plugin.

```bash
npm run infra:up      # start Redis and wait until its health check passes
docker compose -f infra/docker-compose.yml exec redis redis-cli ping   # → PONG
npm run infra:down    # stop and remove the container
```

`npm run dev:api` runs `infra:up` and `npm run db:migrate` (as `nthstock_owner`) for you before
starting apps/api (`DB_DRIVER=postgres` as `nthstock_app`), apps/realtime and the web app in api
mode. `GET /v1/health/ready` on apps/api answers 200 once Postgres and Redis both answer.

The port is bound to loopback only. Do not expose it: this Redis has no authentication and is for
local development only. Cloud environments use managed Redis with auth and TLS (Phase 6).

## Redis in tests

Integration tests that need a real Redis (`*.integration.test.ts` in `apps/api` and
`apps/realtime`) start `redis:7-alpine` with Testcontainers, so they need Docker. CI
(`ubuntu-latest`) has Docker and runs them on every `npm run test`.

Locally without Docker, point them at any running Redis, or skip them explicitly:

```bash
REDIS_TEST_URL=redis://127.0.0.1:6379 npm run test   # use this Redis instead of a container
SKIP_REDIS_INTEGRATION=1 npm run test                # skip, with a printed notice; never in CI
```

Without Docker and without either variable, those suites fail with a message saying so.

## Postgres in tests

Postgres integration tests in `apps/api` (`describeWithPostgres`, helper
`apps/api/src/test/testPostgres.ts`) start `postgres:16-alpine` with Testcontainers, so they need
Docker. Each test worker gets its own database (`nthstock_test_api_<n>`) with the roles from
`postgres/init.sql` and every migration applied; suites connect as `nthstock_app` and the helper
truncates as `nthstock_owner` between tests.

Locally without Docker, point them at any Postgres 16 **superuser** URL, or skip them explicitly:

```bash
POSTGRES_TEST_URL=postgres://postgres:postgres_dev@127.0.0.1:5432/postgres npm run test
SKIP_PG_INTEGRATION=1 npm run test   # skip, with a printed notice; never in CI
```

## k6 smoke tests

[`k6/`](./k6/README.md) holds local-only load scripts (not run in CI): `wsSmoke.js` opens 1,000
live-price sockets against apps/realtime and reports frames per second and p95 delivery latency.
