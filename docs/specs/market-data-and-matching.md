# Spec: Quote service, matcher worker, notifications service and TimescaleDB candles

- Status: draft for owner review, 2026-10-24
- Phase: Wave 3 of the 2026-10-24 roadmap; CLAUDE.md §7 **Phase 4, Market data** and **Phase 5,
  Paper trading** (the server side that Phase 1 built in memory)
- Depends on: [`backend-core.md`](backend-core.md) E15 (paper accounts on Postgres, §5.3) and E16
  (BullMQ jobs, §9). Nothing here starts before E15's account store is merged.
- Inputs: CLAUDE.md D3, D5, D6, §3 and §4; ADR 0004 (mock backend and paper engine), ADR 0007
  (Postgres and jobs), ADR 0012 (trading state); `packages/paperEngine` (`PaperDesk`, `AlertDesk`,
  `trailingStop.ts`), `apps/api/src/ticks/`, `apps/realtime/src/feeds/`, and the load-test results
  in the guide (one api + one realtime process: 10k sockets, p95 under 200 ms to 7,500 users).

## 1. Problem

Phase 1 and Phase 2 made the product work end to end, but four parts of it still only work as
**one process**:

1. **Ticks are made inside `apps/api`.** `ticks/tickPump.ts` runs the GBM random walk in the API
   process. A second API instance would run a second, different random walk, so two users could
   see two prices for INFY at the same moment. CLAUDE.md §4 wants stateless API servers.
2. **Matching is a scan, in the API process.** On every tick `PaperDesk` syncs every engine that
   has a live order in the ticked instrument. The cost grows with the number of users who hold any
   order in that instrument, not with the number of orders that actually cross. That is fine for a
   demo; it is the wrong shape at the D7 target of 10 lakh users.
3. **Trailing stops, price alerts and notifications run only in the browser mock.** In api mode
   the web app polls `/v1/notifications` every 30 s, and a trailing stop is not a server feature
   at all. In India a trailing stop is not an exchange order type, so a broker must run it: that
   is exactly the server feature a reviewer expects to see.
4. **Candles are generated on request.** The chart asks for a range and the market adapter
   synthesises bars. Nothing is stored, so a 1-minute bar the user watched form is not the bar the
   chart shows after a reload.

## 2. Goals and non-goals

### Goals

- **One source of ticks.** A quote service publishes every tick once, to Redis Streams, sharded by
  instrument. The API, the realtime server, the matcher and the candle writer all read the same
  ticks. The tick-to-screen target (CLAUDE.md §3, under 500 ms) still holds, and is measured.
- **A matcher worker** that keeps resting orders in a price-indexed book per instrument, so a tick
  touches only the orders it crosses: O(log n + k) per tick, where k is the number of orders that
  fill or trigger. LIMIT, SL, SL-M and trailing stops are all matched there, against Postgres as
  the record (E15's account store and its version check).
- **A notifications service**: a `notifications` table written in the same transaction as the event
  that caused it (outbox), pushed to the user's sockets within the tick-to-screen budget. This
  replaces the 30 s poll.
- **TimescaleDB candles**: a 1-minute hypertable written from the tick stream, continuous
  aggregates for 5, 15, 30 and 60 minutes and one day, compression after 7 days. The chart reads
  stored bars, and the live bar is built from the same ticks.
- **Same behaviour in both backends.** MSW keeps today's in-browser engine. The dual-backend
  scenario suites gain matcher, trailing-stop and notification scenarios that pass against MSW and
  against the full api stack.

### Non-goals (this wave)

- A real or licensed market data feed (D3). The quote service runs the existing GBM generator
  behind the same `MarketDataAdapter`, so a vendor feed can replace it later.
- Real order routing, an exchange order book, or matching users against each other. Paper orders
  fill against the simulated LTP, as today (D2).
- Web push, email or SMS notifications. In-app only (socket plus the notification centre).
- AWS, autoscaling or the Phase 6 load test at 10 lakh users. This wave adds a local benchmark
  (§10) and a design that shards; it does not prove the D7 numbers.
- Multi-leg orders (OCO, bracket). §13 lists them as the next spec.

## 3. Architecture

```
                         ┌───────────────── Redis 7 ─────────────────┐
apps/quotes (new)        │ Streams  ticks:{shard}   (MAXLEN ~ 10 min) │
 GBM adapter, one writer ├──────────► XADD per tick batch            │
 per shard (lease key)   │ pub/sub  orders:{userId}  notify:{userId}  │
                         │          auth:sessionRevoked               │
                         │ Streams  matcher:commands:{shard}          │
                         └──┬──────────┬───────────┬─────────────┬───┘
                            │          │           │             │
                 XREADGROUP │          │ XREAD     │ XREADGROUP  │ SUBSCRIBE
                            ▼          ▼           ▼             ▼
                   matcher worker   apps/realtime  candle writer  apps/realtime
                   (apps/api entry) quotes to      (apps/api      order updates,
                   books per token  subscribers    entry)         notifications
                            │                          │
                            │ account store commit     │ COPY / upsert
                            ▼ (E15, version check)     ▼
                   PostgreSQL 16 ─ orders, ledger, positions, notifications (outbox)
                                 ─ TimescaleDB: candles_1m hypertable + continuous aggregates
apps/api (stateless): REST /v1. Places, modifies and cancels orders through the account store,
then sends a command to the matcher of that instrument's shard. No tick pump, no matching.
```

- **Shards.** An instrument's shard is `fnv1a(token) mod SHARDS` (`packages/utils`). Locally
  `SHARDS=1` and one process of each kind runs, as today; the design is tested with `SHARDS=4`.
- **Entries, not new services, where we can.** The matcher and the candle writer are new entry
  points in `apps/api` (`src/matcher.ts`, `src/candleWriter.ts`), like the E16 job worker, so they
  share the repos, the account store and the paper engine. The quote service is the one new app,
  `apps/quotes`, because it must not depend on Postgres or on the API's modules: it is the piece a
  vendor feed replaces.
- **One writer per shard.** Each quote and matcher process takes a Redis lease
  (`SET lease:matcher:{shard} <id> NX PX 5000`, renewed every 2 s). A second process for the same
  shard waits. A lost lease stops the process from writing, and the version check in the account
  store makes a late write from a stale process conflict instead of corrupting an account.

## 4. Quote service (`apps/quotes`)

- Runs the existing `marketData` GBM adapter and the NSE session rules unchanged. Every 250 ms it
  writes one batch per shard with `XADD ticks:{shard} MAXLEN ~ 2400 * quotes=<binary>`. The binary
  is the existing 24-byte quote record, so `apps/realtime` forwards it without re-encoding.
- Each batch carries a per-shard `seq`. Consumers detect a gap (a restarted quote service, a
  trimmed stream) and re-read the snapshot key `quotes:last:{shard}` (a hash of token to last
  record) before carrying on.
- `apps/realtime` switches from today's pub/sub tick channel to `XREAD BLOCK` on the streams of
  the instruments its clients follow. Nothing changes on the wire to the browser.
- The API's `/v1/market/quotes` reads `quotes:last:{shard}`, so it serves the same LTP that the
  matcher fills against.

## 5. Matcher worker

### 5.1 Book per instrument

For each instrument in its shard the matcher keeps, in memory:

| Side | Index | Fires when |
|---|---|---|
| BUY LIMIT | max-heap on limit price | LTP ≤ price |
| SELL LIMIT | min-heap on limit price | LTP ≥ price |
| SELL SL / SL-M, trailing SELL | max-heap on trigger price | LTP ≤ trigger |
| BUY SL / SL-M, trailing BUY | min-heap on trigger price | LTP ≥ trigger |

On a tick it pops entries from the top of each heap while they cross, so it only reads orders that
act. Each entry is `(price, orderId, userId, version)`. A trailing stop also sits in a
`token → stops` list that is walked once per tick to ratchet; ratcheting a stop re-keys it in its
heap. The ratchet rule is `packages/paperEngine/src/trailingStop.ts`, moved behind a pure function
so the browser mock and the matcher run the same code.

### 5.2 From a crossing to a fill

1. The matcher groups the crossed entries by user and, per user, calls the account store:
   `load` → apply the fills to that user's `PaperEngine` (the existing engine does the fill
   arithmetic, charges and ledger) → `commit` with the expected version and the audit entries.
2. The commit also inserts the notification rows (§6) and an outbox row for the order update. On a
   version conflict the matcher reloads that user and re-checks the order against the current LTP
   once. If the order is gone (cancelled, modified, already filled) the entry is dropped.
3. After commit the matcher publishes `orders:{userId}` and `notify:{userId}`. Publishing after
   commit means a socket never shows a fill the database does not have. A crash between commit and
   publish is covered by the outbox relay (§6.2).
4. **Idempotency.** A fill records `(order_id, tick_seq)`, unique per order. A replayed tick batch
   after a restart cannot fill an order twice.

### 5.3 Keeping the book in step

- **Commands.** `apps/api` writes `matcher:commands:{shard}` after its own commit: `ADD`, `MODIFY`,
  `CANCEL`, `STOP_ADD`, `STOP_CANCEL` with the order's new version. The matcher applies a command
  only if its version is newer than the entry it holds.
- **Start-up and repair.** On start, and every 60 s, the matcher reads the live orders of its shard
  from Postgres (`orders WHERE status IN ('OPEN','AMO') AND shard = $1`, with a partial index) and
  reconciles the book. A lost command is therefore repaired in at most a minute, and every fill is
  still checked against Postgres before it is written.
- **Session events** (AMO release 09:15, square-off 15:20, day close 15:30) stay E16 jobs. The
  matcher only ignores ticks outside market hours, as the engine already does.

### 5.4 What `apps/api` stops doing

`DEFAULT_ORDER_SWEEP_MS`, the tick pump and the per-tick `PaperDesk.ingest` leave the API process
in api mode (`MATCHER_MODE=worker`). `MATCHER_MODE=inline` keeps today's in-process desk for unit
tests and for the `/v1/__test` scripted-tick routes, so no existing test changes behaviour.

## 6. Notifications service

### 6.1 Data

`notifications(id bigserial, user_id, kind, ref_id, title, body, created_at, read_at)`, indexed on
`(user_id, id DESC)`. Kinds: `ORDER_EXECUTED`, `ORDER_REJECTED`, `TRAILING_STOP_TRIGGERED`,
`PRICE_ALERT`, `AMO_RELEASED`, `SQUARED_OFF`, `SECURITY` (new login, two-factor change, all sessions
logged out). The body is built from contract types and never holds a mobile number or a name. The
newest 100 per user are kept, as today; the E16 cleanup job trims the rest daily.

### 6.2 Delivery

- Rows are inserted in the same transaction as their cause (a fill, a stop, a login), so a
  notification exists exactly when its event does.
- `notification_outbox(id, user_id, notification_id)` is written in the same transaction. After
  commit the writer publishes `notify:{userId}` and deletes its outbox row. A relay in the job
  worker publishes rows older than 5 s every 5 s, so a crash only delays delivery.
- `apps/realtime` subscribes per connected user (the pattern `orderFeed.ts` already uses) and sends
  the existing `notification` WS message. The web app stops polling in api mode; it re-reads
  `/v1/notifications` only after a reconnect.
- **Price alerts** move from `AlertDesk` in the API process to the matcher: an alert is one more
  heap entry (ABOVE in the min-heap, BELOW in the max-heap), so it fires on the same tick with the
  same rules as today.

## 7. TimescaleDB candles

### 7.1 Storage

```sql
CREATE TABLE candles_1m (
  token int NOT NULL, bucket timestamptz NOT NULL,
  open bigint NOT NULL, high bigint NOT NULL, low bigint NOT NULL, close bigint NOT NULL,
  volume bigint NOT NULL, PRIMARY KEY (token, bucket)
);  -- prices in paise (CLAUDE.md §6)
SELECT create_hypertable('candles_1m', 'bucket', chunk_time_interval => interval '1 day');
ALTER TABLE candles_1m SET (timescaledb.compress, timescaledb.compress_segmentby = 'token');
SELECT add_compression_policy('candles_1m', interval '7 days');
```

Continuous aggregates `candles_5m`, `candles_15m`, `candles_30m`, `candles_1h` and `candles_1d`
use `time_bucket` with the IST session origin (09:15), so a 15-minute bar starts at 09:15, 09:30
and so on, as on NSE. Each has a refresh policy of one bucket.

### 7.2 Writing

- The candle writer reads the tick streams in its own consumer group, keeps the forming 1-minute
  bar per instrument in memory, and on each minute boundary writes the closed bars in one
  multi-row `INSERT … ON CONFLICT (token, bucket) DO UPDATE`. A restart re-reads the stream from
  its last acknowledged id, so no minute is lost and none is double counted.
- **History.** A one-off seed job writes 2 years of daily bars and 30 days of 1-minute bars for
  the seeded symbols from the existing deterministic generator, so charts have depth on day one
  and the seed is the same on every machine.

### 7.3 Reading

`GET /v1/market/instruments/:symbol/candles` keeps its contract (`range`, `interval`). It reads
the matching aggregate, then appends the forming bar from `quotes:last` so the chart's last bar
moves with the ticks. 1-minute bars come from the hypertable, 5 minutes to 1 hour from the
aggregates, and 1W to 5Y ranges from `candles_1d`.

### 7.4 Database setup

- Local: the Compose Postgres image becomes `timescale/timescaledb:2.x-pg16` (the
  Apache-licensed core plus the free community features). `CREATE EXTENSION timescaledb` runs in
  the migration as `nthstock_owner`; `nthstock_app` keeps DML only.
- Migrations stay Drizzle-generated SQL. Hypertable and policy calls go in hand-written migration
  files, and `db:check` learns to skip TimescaleDB catalog objects.

## 8. Contracts

- `packages/contracts`: `TickBatch` (shard, seq, records), `MatcherCommand`, `NotificationKind`
  extended with the kinds in §6.1, `TrailingStop` routes for api mode
  (`POST /v1/orders/:id/trailing-stop`, `DELETE …`), the same shapes the MSW mock serves today.
- The scenario suites gain `matcher`, `trailingStop` and `notifications` scenarios. A scenario
  pins a price through `/v1/__test/ticks`, which in worker mode writes into the stream, so the same
  scenario drives MSW and the full stack.

## 9. Security and compliance

- Workers connect with the `nthstock_app` role and hold no secrets beyond `DATABASE_URL` and
  `REDIS_URL`.
- Redis channels carry user ids and order ids, never a mobile number or a name (as today).
- Every fill, trigger and alert writes the same audit entries it writes today, inside the commit.
- The quote service publishes simulated prices only (D3, CLAUDE.md §9).

## 10. Testing and benchmarks

- Unit: book heaps (property tests: a tick pops exactly the entries that cross), ratchet rule,
  command versioning, bucket origin at 09:15 IST, outbox relay.
- Integration on Postgres + Redis + TimescaleDB: crash between commit and publish, duplicate tick
  replay, two matchers racing for one lease, a modify racing a fill (one wins, the other answers
  409 or is dropped).
- Scenario suites against MSW and the full stack, as for E11 to E19.
- E2E in api mode: place a LIMIT, script a crossing tick, see the fill toast within 1 s; set a
  trailing stop, ratchet it and trigger it; reload the chart and see the same 1-minute bars.
- **Benchmark** (`tools/loadTest/matcher.mjs`): 1 lakh resting orders over 500 instruments, a tick
  per instrument every 250 ms. Target on one 4-vCPU process: p95 tick-to-fill-commit under 100 ms,
  tick-to-screen p95 under 500 ms. Reported on the guide's performance tab next to the existing
  load test.

## 11. Acceptance criteria

1. Two API instances serve the same LTP for every instrument at every moment (one quote source).
2. With `MATCHER_MODE=worker`, no API process subscribes to ticks; killing and restarting the
   matcher loses no fill and fills nothing twice (integration test).
3. A tick reads only the orders it crosses (counter in the benchmark: orders read per tick equals
   orders filled or triggered, plus the stop ratchet walk).
4. Trailing stops work in api mode with the same rules and UI as the mock.
5. A fill, a stop trigger and a price alert reach the user's socket as a `notification` within the
   500 ms tick-to-screen budget; the web app no longer polls in api mode.
6. The chart shows stored bars for 1m to 1D intervals; a reload shows the same bars it showed
   live; 15-minute bars start at 09:15 IST.
7. Every scenario suite passes against MSW and the full stack; `npm run check` and the E2E suite
   are green; the guide and `docs/architecture.md` describe all four parts.

## 12. Plan (epics and stories)

Issue keys come from `tools/github/issueKey.sh` once this spec is merged.

| Epic | Stories |
|---|---|
| E22 Quote service | `apps/quotes` app and lease; tick streams and snapshot key; realtime reads streams; `/v1/market/quotes` from the snapshot; tick-to-screen latency test across processes |
| E23 Matcher worker | book heaps in `packages/paperEngine`; matcher entry and shard lease; commands from `apps/api`; reconcile loop; fills through the account store with idempotency; trailing stops on the server and their routes; `MATCHER_MODE`; benchmark |
| E24 Notifications service | table, outbox and relay; realtime fan-out; alerts on the matcher; security notifications; web app drops the poll |
| E25 TimescaleDB candles | Compose image and extension migration; hypertable, aggregates and policies; candle writer; history seed; candles route on stored bars; `db:check` support |

Order: E22, then E23 and E25 in parallel, then E24. Each epic ends with its docs (guide and
`docs/architecture.md`) and a production release, as for E17 to E19.

## 13. Risks

| Risk | Mitigation |
|---|---|
| **TimescaleDB is not available on AWS RDS** (Phase 6, D7) | Open question 1. The schema keeps plain `time_bucket` queries so a fallback to native partitions plus rollup tables is a contained change. |
| Lease flapping gives two writers | Version check in the account store and the `(order_id, tick_seq)` unique key; integration test for two matchers. |
| Redis Stream memory | `MAXLEN ~` per shard (about 10 minutes of ticks); consumers recover from the snapshot key. |
| A command lost between API and matcher | Reconcile loop every 60 s, and every fill re-checked against Postgres. |
| Scope: four epics | Each epic ships and releases on its own; the API keeps `inline` mode, so nothing breaks while the worker lands. |

## 14. Dependencies needing owner OK

- The `timescale/timescaledb` Docker image for local Postgres (free; core Apache 2.0, compression
  and continuous aggregates under the free Timescale License). CLAUDE.md D6 already names
  TimescaleDB from Phase 4.
- No new npm dependency: Redis Streams use `ioredis`, which the repo already has.

## 15. Open questions for the owner

1. **TimescaleDB in AWS (Phase 6).** RDS for PostgreSQL does not offer the extension. Options:
   (a) self-managed Postgres + TimescaleDB on EC2 in Mumbai, (b) Timescale Cloud in AWS Mumbai
   (paid), (c) drop TimescaleDB for native partitions and rollup tables. Recommended: decide at
   Phase 6; build on TimescaleDB now, since D6 already chose it.
2. **Trailing stop in api mode for every order type?** Recommended: same as the mock (on an open
   position, MARKET exit on trigger), so the UI does not change.
3. **Security notifications** (new login, two-factor change): recommended in this wave, since the
   table and fan-out are being built anyway.

## 16. Out of scope

Licensed feeds, exchange connectivity, multi-leg orders (OCO, bracket), web push, email or SMS,
autoscaling, the Phase 6 load test, and a P&L history screen.
