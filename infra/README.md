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

## Redis 7 (Docker Compose)

`docker-compose.yml` runs Redis 7 on `127.0.0.1:6379` with no password and no persistence. It
carries live ticks from `apps/api` to `apps/realtime` over pub/sub (ADR 0004 §4).

Requires Docker with the Compose plugin.

```bash
npm run infra:up      # start Redis and wait until its health check passes
docker compose -f infra/docker-compose.yml exec redis redis-cli ping   # → PONG
npm run infra:down    # stop and remove the container
```

`npm run dev:api` runs `infra:up` for you before starting apps/api, apps/realtime and the web app
in api mode.

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

## k6 smoke tests

[`k6/`](./k6/README.md) holds local-only load scripts (not run in CI): `wsSmoke.js` opens 1,000
live-price sockets against apps/realtime and reports frames per second and p95 delivery latency.
