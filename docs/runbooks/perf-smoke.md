# Performance smoke: order ack, PIN login and the slowest queries

T-243 (NSTOCK-0243), spec [backend-core](../specs/backend-core.md) §14 ("Performance smoke") and
acceptance criterion 27. Script: [`apps/api/src/perf/smokeCli.ts`](../../apps/api/src/perf/smokeCli.ts). For the
1,000 to 10,000 user load test across apps/api and apps/realtime, see [load-test.md](load-test.md).

## Budgets

| Check                                    | Budget   |
| ---------------------------------------- | -------- |
| MARKET order ack (`POST /v1/orders`) p95 | < 300 ms |
| PIN login (`POST /v1/auth/pin/verify`) p95 | < 200 ms |
| Slowest query p95                        | < 50 ms  |

Any failed request also fails its route's check. The script exits 1 when a check fails.

## What it does

1. Builds apps/api in process on Postgres (`DB_DRIVER=postgres`, the `nthstock_app` role), with
   the mock market on a fixed NSE trading day (28 Sep 2026, 10:00 IST, then real time), so MARKET
   orders fill whatever day it runs. No ticks and no Redis: the numbers are the request alone.
2. **Seeds** `PERF_USERS` users (default 10,000; mobiles 6100000000 upwards) through the app's
   own Postgres repos, so PII is encrypted and every row is valid. Each has PIN `135790` and a
   trusted device. Seeding is idempotent: a second run reuses them and only creates what is
   missing.
3. Gives the users it measures a fresh trusted-device token, spread over the whole range, and
   warms up with `PERF_WARMUP` logins and orders (not counted).
4. **Measures** `PERF_SAMPLES` PIN logins (default 500), then one MARKET buy of 1 share per
   logged-in user, `PERF_CONCURRENCY` (default 4) at a time, each user from its own loopback
   address so the per-IP auth limits apply per user. 4 matches libuv's thread pool, where the
   Argon2id PIN check runs.
5. **Queries:** reads `pg_stat_statements` before and after the measured phase and reports the
   difference for the app role, slowest first. It keeps no percentiles, so p95 is estimated as
   mean + 1.645 × stddev (capped at the max for a statement first seen in the run). It also times
   every statement on the client (send to result, network included). The query check uses
   pg_stat_statements when it is there, else the client-side timings, and the report says which.
6. Prints the markdown report, writes it to `PERF_REPORT_PATH` (default `apps/api/perf-report.md`,
   gitignored) and appends it to the GitHub job summary in CI.

It refuses `NODE_ENV=production` and a non-loopback `DATABASE_URL` (set
`PERF_SMOKE_ALLOW_REMOTE=true` only for a throwaway database): it writes thousands of users with a
known PIN.

## Run it locally

```bash
npm run infra:up && npm run db:migrate
# Once per volume: preload pg_stat_statements (the image preloads only timescaledb).
docker compose -f infra/docker-compose.yml exec postgres \
  psql -U postgres -d nthstock -c "ALTER SYSTEM SET shared_preload_libraries = 'timescaledb,pg_stat_statements'"
docker compose -f infra/docker-compose.yml restart postgres
npm run perf:smoke
```

The root script fills in the local URLs: `DATABASE_URL` (nthstock_app), `DATABASE_MIGRATION_URL`
and `PERF_STATS_URL` (the Compose superuser, which can create the extension and read every role's
statements). Without the preload step the report says pg_stat_statements is unavailable and judges
the queries on the client-side timings.

| Variable           | Default                    | Meaning                                    |
| ------------------ | -------------------------- | ------------------------------------------ |
| `PERF_USERS`       | 10000                      | users in the database after seeding        |
| `PERF_SAMPLES`     | 500                        | measured PIN logins, and as many orders    |
| `PERF_WARMUP`      | 20                         | logins and orders before measuring         |
| `PERF_CONCURRENCY` | 4                          | requests in flight                         |
| `PG_POOL_MAX`      | the app's default (10)     | the app's pool                             |
| `PERF_STATS_URL`   | `DATABASE_MIGRATION_URL`   | role that reads pg_stat_statements         |
| `PERF_REPORT_PATH` | `perf-report.md`           | report file, relative to `apps/api`        |

Run it alone: other suites or a dev server on the same machine measure the machine, not the code
(the `latency` skill). To start again from no perf users, `npm run infra:down` and remove the
volume, or delete the users with mobiles 6100000000 to 6100009999 as the owner.

## In CI

The `e2e-api` job in `.github/workflows/ci.yml` runs it after the api-mode Playwright suite, on
the job's Postgres service with 10,000 users. A step before it preloads pg_stat_statements and
restarts the service; if that step fails the smoke still runs and reports the client-side timings.
The spec makes it "not a CI gate this phase" (§14), so a failed budget marks the step, not the
job. The report is in the job summary and the `perf-report` artifact; attach it to the PR.

## Reading a failure

- **PIN login slow, queries fast:** Argon2id (19 MiB, 2 passes) is CPU bound in the thread pool.
  Compare with `PERF_CONCURRENCY=1`; queueing behind 4 threads shows as p95 well above p50.
- **Order ack slow:** the first order of a user loads the account from Postgres; look for the
  account and ledger statements in the query tables.
- **One query slow:** run it with `EXPLAIN (ANALYZE, BUFFERS)` as the owner and check the index
  from `apps/api/src/db/schema/` it should use.
