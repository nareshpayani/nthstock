# Load test: 1,000 to 10,000 concurrent users

NSTOCK-0341, run on 2026-10-24. Script: [`tools/loadTest/loadTest.mjs`](../../tools/loadTest/loadTest.mjs).
Raw results: [`tools/loadTest/results/`](../../tools/loadTest/results/). The scaling design these
numbers feed is CLAUDE.md §4 and [architecture.md](../architecture.md#scalability-rules). For the
single-process smoke on order ack, PIN login and the slowest queries (T-243), see
[perf-smoke.md](perf-smoke.md).

## What a virtual user does

Every virtual user is a real account on the real backend, not a mocked request:

1. **Logs in** with `POST /v1/auth/otp/request` and `POST /v1/auth/otp/verify` (the development
   OTP). That creates the user, the paper account and a session in Postgres, plus the OTP
   challenge in Redis.
2. **Opens a WebSocket** to `apps/realtime` with its `nth_at` access cookie, subscribes to 10 of 20
   large caps and pings every 20 s, like the web app.
3. **Loads pages** until the clock runs out: one API call, then a pause (the "pace", ±50% jitter).
   The mix is 30% batch quotes, 15% each of positions, portfolio summary and orders, 10% depth, 5%
   funds, and 10% **paper orders** (`POST /v1/orders`, market buy of 1 share), which write
   orders, fills, the ledger and positions in Postgres.

Each user sends from its own loopback address (127.x.y.z). The per-IP rate limits (600 requests a
minute, 20 OTP requests a minute) then apply per user, as they would behind a load balancer,
instead of throttling the whole test as one client. Four worker processes run the users.

## Set-up

| Item         | Value                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------- |
| Machine      | 4 vCPU Intel Xeon, 16 GB RAM, Linux (a cloud development container)                       |
| apps/api     | one Node 22 process, `DB_DRIVER=postgres`, `PG_POOL_MAX` 10 (default) or 30, logging on   |
| apps/realtime| one Node 22 process                                                                       |
| Data         | PostgreSQL 16 and Redis 7 on the same machine, all migrations applied                     |
| Market       | the mock market forced open (`MOCK_MARKET_ALWAYS_OPEN=true`), about 5,000 instruments     |
| Load         | 60 s of sessions after every user has logged in; generator on the same machine           |

The generator shares the 4 cores with the servers, Postgres and Redis, so every number here is a
floor, not a ceiling.

## Results

| Users  | Pace       | Pool | Logins p95 | Logins/s | API req/s | API p50 | API p95  | API p99  | Errors | Sockets open | Tick age p95 |
| ------ | ---------- | ---- | ---------- | -------- | --------- | ------- | -------- | -------- | ------ | ------------ | ------------ |
| 1,000  | 1 call/5 s | 10   | 733 ms     | 373      | 179       | 1.6 ms  | 5.4 ms   | 10.2 ms  | 0      | 1,000        | 276 ms       |
| 5,000  | 1 call/5 s | 10   | 511 ms     | 515      | 887       | 2.1 ms  | 27.2 ms  | 58.6 ms  | 0      | 5,000        | 205 ms       |
| 7,500  | 1 call/5 s | 30   | 399 ms     | 582      | 1,326     | 11.4 ms | 143 ms   | 350 ms   | 0      | 7,500        | 306 ms       |
| 10,000 | 1 call/5 s | 10   | 432 ms     | 564      | 1,298     | 1.9 s   | 5.8 s    | 7.3 s    | 0      | 10,000       | 355 ms       |
| 10,000 | 1 call/5 s | 30   | 437 ms     | 597      | 1,427     | 1.1 s   | 3.4 s    | 6.6 s    | 0      | 10,000       | 405 ms       |
| 10,000 | 1 call/15 s| 30   | 476 ms     | 537      | 484       | 2.0 ms  | 88.1 ms  | 135 ms   | 0      | 10,000       | 436 ms       |

"Tick age" is receipt time minus the newest quote's tick time in each binary frame: tick to
client, including the 250 ms conflation window, before the browser paints. Peak process figures:
apps/api 120% CPU and 949 MB at 10,000 users; apps/realtime 40% CPU and 456 MB with 10,000 open
sockets, and no dropped frames in any run.

## What it shows

- **Logins:** 10,000 users logged in within 18.6 s at 200 at a time, with a p95 under 0.5 s and
  no failures. That is about 550 logins a second from one API process.
- **Live prices:** one realtime process held 10,000 sockets, about 10,900 frames a second, with
  every tick on screen in under 500 ms (CLAUDE.md §3) and no dropped frames. It used 40% of one
  core, so it has room for more.
- **API ceiling:** one API process serves about 1,300 to 1,400 requests a second on this machine.
  Up to 7,500 users at one call every 5 s, the p95 stays inside the 200 ms target. At 10,000 users
  at that pace the offered load (2,000 a second) exceeds it: market routes (in memory) stay fast,
  but database routes queue for seconds. A bigger pool (10 to 30) helps a little; the limit is the
  one Node process, at 100% of a core.
- **10,000 users at a realistic pace:** live data arrives over the socket, so a user calls the API
  when they open a page or trade, not every second. At one call every 15 s, one process serves
  10,000 users at a 88 ms p95.

## How it scales past this

- **API:** it keeps no state in the process (sessions, OTPs and rate limits are in Redis, data is
  in Postgres), so more API tasks behind the load balancer add capacity, about 1,300 requests a
  second each on this hardware. Order matching now has its own worker (`apps/matcher`, below);
  with `MATCHER_MODE=worker` and the quote service, API tasks follow no ticks and scale freely.
- **Realtime:** add nodes; each takes its share of sockets and reads the same Redis channel.
- **Postgres:** PgBouncer in transaction mode (already in `infra/docker-compose.yml`, profile
  `pool`), read replicas for portfolio and order history, and day partitions for orders (the `orders` and
  `order_events` tables are already partitioned; only the default partition exists today).

## Matcher (NSTOCK-0370)

Measured on 25 October 2026 on the same 4 vCPU machine, Node 22, Redis 7 and PostgreSQL 16, in
three parts that add up to tick to fill commit (spec market-data-and-matching §10, ADR 0013).

**1. The books** (`node tools/loadTest/matcher.mjs --duration 30 --redis …`): 1,00,000 resting
LIMIT orders and 10,000 trailing stops over 500 instruments in one process, every instrument
ticking every 250 ms (2,000 ticks a second) on a stressed random walk (0.25% a tick, about 40 times
a real stock's volatility, so a short run fills a lot). Crossed orders and triggered stops are
replaced at the new price, so the book stays full.

| Measure | Result |
| --- | --- |
| Ticks | 60,020 in 30 s, 2,000 a second, scheduler lag p95 0.6 ms |
| Book time per tick | p50 0.008 ms, p95 0.058 ms, p99 0.095 ms |
| Book time on a tick that crosses | p50 0.026 ms, p95 0.079 ms, p99 0.115 ms |
| Heap entries read per tick | mean 6.8, max 163; walking every order and stop would read 220 |
| Read against acted on | 408,119 read = 158,623 fills + 13,772 triggers + 183,360 ratchets + 52,364 stale |
| Fill requests | 172,246 (one per user per crossing tick) |
| Tick to request read by apps/api (Redis) | p50 1.0 ms, p95 3.1 ms, p99 5.1 ms |

Every entry a tick reads is one it fills, triggers or moves, or an entry a ratchet left behind
(spec §11 criterion 3). Loading 1,00,000 orders takes about 0.1 s.

**2. The commit** (`matcherFillLatency.integration.test.ts`, `MATCHER_BENCH_USERS=400`): apps/api
with `MATCHER_MODE=worker` on Postgres and Redis reads fill requests from the stream and commits
each through the account store. Latency runs from the `XADD` to the order update, which apps/api
sends only after the commit.

| Load | p50 | p95 | p99 | Throughput |
| --- | --- | --- | --- | --- |
| Steady, 100 requests a second | 4.5 ms | 6.5 ms | 8.9 ms | |
| One tick that crosses 200 users at once | 170 to 217 ms | 296 to 352 ms | 305 to 362 ms | 550 to 650 commits a second |

**3. To the screen:** the order update goes apps/api → Redis pub/sub → apps/realtime → socket, the
path the latency test measures at a p95 of 86 to 106 ms.

**Result:** at a steady rate, tick to fill commit is about 10 ms at p95 (0.08 + 3.1 + 6.5 ms),
against the 100 ms target, and tick to screen about 110 ms, against 500 ms. The gap is a burst:
one apps/api process commits 550 to 650 fills a second, because each fill is its own Postgres
transaction (account, order, order event, ledger, position and audit rows). A tick that crosses
200 users at once therefore commits its last fill about 0.3 s later, and the stressed walk above
asks for about 5,700 fills a second, nine times what one process commits. That is what ADR 0013
plans for: every apps/api process in the `api` consumer group takes a share of the requests, so
fill capacity grows with API tasks (about 600 a second each here) and with the pool, while the
matcher itself stays far from its limit.

## Run it

Needs PostgreSQL 16 and Redis 7 (`npm run infra:up`, or local servers) and the built servers.

```bash
npm run infra:up && npm run db:migrate
npx turbo run build --filter=@nthstock/api --filter=@nthstock/realtime
export JWT_SECRET="$(openssl rand -base64 48)"   # one key for both servers; never commit it
(cd apps/api && MOCK_MARKET_ALWAYS_OPEN=true DB_DRIVER=postgres REDIS_URL=redis://127.0.0.1:6379 \
  DATABASE_URL=postgres://nthstock_app:nthstock_app_dev@127.0.0.1:5432/nthstock node dist/server.js) &
(cd apps/realtime && node dist/server.js) &
node tools/loadTest/loadTest.mjs --users 1000 --duration 60 --think 5000 \
  --api-pid <apps/api pid> --rt-pid <apps/realtime pid> --out results.json
```

Options: `--users`, `--duration` (s), `--think` (ms between a user's calls), `--login-concurrency`
(default 200), `--order-share` (default 0.1), `--workers` (default 4), `--api`, `--ws`. The PIDs
are optional and only add the CPU and memory columns. Wait 30 s between runs with the same users:
the OTP resend throttle refuses a second login sooner. Development only: production never accepts
the development OTP.
