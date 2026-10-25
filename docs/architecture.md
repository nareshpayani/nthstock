# Architecture and stack

Moved out of CLAUDE.md on 2026-10-07 so CLAUDE.md stays short. Section numbers match the CLAUDE.md
sections that ADRs and specs cite (CLAUDE.md §4 and §5). Decisions live in [`adr/`](adr/).

## 4. Architecture

```
Browser (Vite React SPA, PWA shell cache)
   │  HTTPS REST /v1            WSS (live prices)
   ▼                            ▼
CDN + WAF ─► Load balancer ─► apps/api (Fastify, stateless)     apps/realtime (WS nodes)
                               │  modules: auth, users,            ▲ per-symbol subscriptions,
                               │  watchlists, orders,              │ max 4 updates/sec/symbol
                               │  portfolio, market                │
                               ▼                                   │ pub/sub: Redis → NATS JetStream at scale
                  PostgreSQL primary + replicas (PgBouncer)   Redis Cluster (quotes, sessions, BullMQ)
                                                                   ▲
                                              packages/marketData feed adapters (mock | vendor later)
```

### Scalability rules
- API servers hold no state; scale horizontally behind the load balancer.
- Scheduled pre-scale at 8:45 AM IST, reactive autoscaling during the day, scale down after 3:45 PM.
- Realtime nodes send only subscribed symbols, conflated to 4 updates/sec, compact binary frames.
- Postgres: read replicas + PgBouncer; orders partitioned by day; shard by user_id (Citus) only when needed.
- CDN caches static assets and public market snapshots (1–5 s TTL); Redis caches quotes, sessions, hot lists.
- Under overload, shed non-critical features first (promos, movers, chart history); login, prices and orders stay up.
- Load tests with k6: 1 lakh → 10 lakh concurrent sockets, 50k logins/sec; one large test near 1 crore before launch.
- Measured so far (2026-10-24, [runbooks/load-test.md](runbooks/load-test.md)): one API process and one
  realtime process on a 4-core machine held 10,000 logged-in users and 10,000 sockets with zero errors;
  the API stays inside its 200 ms p95 up to about 1,300 requests a second per process.

### Frontend stack
- React 19 + TypeScript strict, Vite SPA, TanStack Router.
- Server state: TanStack Query. UI state: Zustand. Live prices: a dedicated quote store outside React render; each price cell subscribes to its own symbol; updates batched per animation frame.
- Styling: our own design tokens (CSS variables in `packages/tokens`) → Tailwind CSS preset generated from them; Radix UI primitives; single light theme.
- Charts: TradingView Lightweight Charts (lazy-loaded); SVG sparklines.
- Lists: TanStack Virtual. Forms: React Hook Form + Zod.
- Assets: self-hosted subset fonts, SVG icons, AVIF/WebP images, skeleton loaders. Service worker caches the app shell.
- Testing: Vitest, React Testing Library, Playwright (Chrome), Storybook, axe (WCAG 2.2 AA).
- Mocking: MSW, typed from `packages/contracts`.

### Backend stack
- Node.js 22 LTS + TypeScript, Fastify. REST under `/v1`, OpenAPI generated from Zod schemas in `packages/contracts`.
- Drizzle ORM, PostgreSQL 16, Redis 7, BullMQ jobs (session events, EOD settlement, P&L snapshots, maintenance; see Background jobs).
- Auth: OTP (mock SMS provider until launch) + device PIN (Argon2id) + optional TOTP; 15-min JWT access token + rotating refresh token in httpOnly SameSite=Strict cookie, revocable in Redis.
- Testing: Vitest, Supertest, Testcontainers, contract tests.

### Paper accounts on PostgreSQL
Spec `backend-core.md` §5.3, ADR 0007. The `AccountStore` (`apps/api/src/modules/orders/accountStore.ts`; memory in
`repo.ts`, Postgres in `pgRepo.ts`) is the record of each paper account; the per-user `PaperEngine` on the `PaperDesk`
is a cache of it.
- **Load:** the first use of an account loads its working set (live orders, today's orders, positions, holdings and
  today's ledger, with the earlier ledger carried as a balance) and its version.
- **Commit:** every engine change is committed with its audit entries in one transaction against the version it was
  read at. A commit that loses to another writer reloads the account and runs the action once more; losing twice
  answers 409 `CONFLICT`. Any other failure answers 500 and the account is reloaded before its next use. Each user's
  commits run in order on a per-user queue; users never wait for each other.
- **Reads:** the order book, order history and funds ledger pages read from the store, so they cover every day.
- **Restart:** at boot, and on the order sweep if the database was down then, apps/api loads every account with an
  AMO or OPEN order, so a resting order fills on the first crossing tick after a restart.
- **Reset and demo seed:** a reset clears the stored orders and their history (the ledger is append-only and keeps
  every row); the demo seed replaces the whole account.

### Quote service (Wave 3, E22)
Spec `market-data-and-matching.md` §4. `apps/quotes` will be the one source of ticks, so every API instance,
apps/realtime, the matcher and the candle writer see the same prices. It depends on nothing but Redis, because it
is the piece a licensed vendor feed replaces (D3).
- **Shards:** an instrument's shard is `shardOf(token, SHARDS)` (`@nthstock/utils`, FNV-1a). Locally `SHARDS=1`.
- **One writer per shard:** a process writes only while it holds `lease:quotes:{shard}` (`SET … NX PX 5000`, renewed
  every 2 s). A second process waits and takes over when the holder stops, or within the TTL when it dies.
- **Streams:** each batch is appended to `nthstock:ticks:v1:{shard}` (`XADD MAXLEN ~ 2400`, about 10 minutes) with a
  per-shard `seq`, and its quotes go to the snapshot hash `nthstock:quotes:last:v1:{shard}` in the same MULTI. A
  consumer that sees any `seq` other than the next one re-reads the snapshot (`tickStreamStep` in
  `packages/contracts`).
- **apps/realtime reads the streams** when `QUOTE_SHARDS` is set (`feeds/streamFeed.ts`): at start it loads each
  shard's snapshot, then follows every stream with one blocking `XREAD`. A gap or a restarted writer (its `seq` starts
  again at 1) triggers a snapshot re-read; a malformed entry is logged and skipped. Without `QUOTE_SHARDS` it keeps
  the pub/sub feed from the API's tick pump.
- **apps/api on the quote service** (`QUOTE_SHARDS` with `REDIS_URL`, `ticks/quoteStreams.ts`): the adapter is built
  with `externalTicks`, so it never runs its own random walk; it starts from the snapshots and moves on every stream
  batch (`MockMarketDataAdapter.applyQuotes`), so the paper desk, alerts, lists, movers and candles all follow the one
  quote service, and the tick pump does not start. `GET /v1/market/quotes` reads the snapshot hashes directly, so
  two instances answer the same LTP at the same moment. Both apps read the streams through `followTickStreams` in
  `packages/marketData`. Without `QUOTE_SHARDS` nothing changes: the adapter ticks in process.
- **Locally:** `npm run dev:api` starts apps/quotes beside apps/api, apps/realtime and the web app, with
  `QUOTE_SHARDS=1`, so the full stack runs on the quote service by default (Compose runs Postgres and Redis; the apps
  run under Turborepo).
- **Latency (NSTOCK-0355):** `npm run test:latency -w @nthstock/realtime` measures tick-to-screen across apps/quotes,
  Redis Streams, apps/realtime and a WebSocket client (plus one frame to paint), beside the API tick-pump path.
  Locally: p95 240 to 260 ms on the quote service against 86 to 106 ms on the pump, both under the 500 ms target. The
  difference is the 250 ms batch window of the writer; CI asserts the p95 on every PR.

### Matcher (Wave 3, E23)
Spec `market-data-and-matching.md` §5. A matcher worker will fill resting orders and trigger trailing stops off the tick
streams, so apps/api stops matching in process.
- **Order book** (`OrderBook` in `packages/paperEngine`, NSTOCK-0363): per instrument, BUY and SELL LIMIT orders sit
  in price heaps and trailing stops in heaps on their stop, watermark and activation prices. A tick pops only what it
  fills, triggers, ratchets or activates, and moves every stop with `stepTrailingStop`, the rule the engine and the
  browser mock run, so it leaves each stop where stepping every stop would (property-tested against that full walk).
  A change applies only when its version is newer than the one held.
- **Worker** (`apps/matcher`, NSTOCK-0364): one process per shard holds `lease:matcher:{shard}` (the same
  `startLease` as apps/quotes, now in `packages/marketData`) and follows that shard's tick stream with
  `followTickStreams`. Every process for the shard keeps following, so a standby is current when it takes over;
  only the holder runs ticks through the books, and only in market hours (`MOCK_MARKET_ALWAYS_OPEN` for demos).
  `npm run dev:api` starts it.
- **Order commands** (`MatcherCommand` in `packages/contracts`, NSTOCK-0365): after each order commit apps/api
  appends `ADD`, `MODIFY` or `CANCEL` for a LIMIT order to `nthstock:matcher:commands:v1:{shard}` (capped at
  100,000 entries), carrying the account version of that commit. Every matcher process for the shard reads the
  stream with `XREAD BLOCK` and applies each command to the instrument's book by the version rule, so a late or
  replayed command never undoes a newer one; malformed entries are logged and skipped. After each trailing stop
  change apps/api also sends `STOP_ADD` (an `ARMED` or `TRAILING` stop with the state the book steps; a ratchet
  is a `STOP_ADD` too) or `STOP_CANCEL` (any other status), at the same account version (NSTOCK-0368).
- **Reconcile** (NSTOCK-0366): on start and every 60 s the matcher reads its shard's OPEN LIMIT orders and the
  account versions from Postgres in one REPEATABLE READ snapshot, through the `orders_shard_live_idx` partial
  index on `orders.shard` (migration 0016, set on insert as `shardOf(token, QUOTE_SHARDS)`). It upserts every
  live order and takes off any order Postgres no longer has live, each at the account version, so a lost command
  is repaired within a minute while a command newer than the read stands. An upsert at the same price keeps the
  order's heap entry, so the rounds leave nothing stale. Rows from before the column are matched by token.
  The same round reconciles trailing stops: it reads the ARMED and TRAILING rows of `trailing_stops` (what
  `STOP_ADD` puts on a book) in that snapshot, keeps those whose token maps to the shard (the table has no shard
  column), upserts or removes them at the account version, and puts back a stop a tick triggered whose fill never
  committed.
- **Fills** (NSTOCK-0367, [ADR 0013](adr/0013-matcher-fills-commit-in-api.md)): the matcher finds fills, apps/api
  commits them. For each tick that crosses an order or triggers a stop the lease holder writes one `MatcherFill` per
  user to `nthstock:matcher:fills:v1:{shard}`; every apps/api process reads those streams in the `api` consumer
  group, runs the user's engine at the tick's price and time (`PaperDesk.ingestFor`), commits through the account
  store with the expected version, publishes the order update and only then acks. The engine re-checks every
  order, so a replayed request fills nothing twice and a request for an order modified since fills only what still
  crosses. A request a crashed process held is claimed after 30 s; an unsent one puts its orders back on the book.
- **`MATCHER_MODE`** (NSTOCK-0369, spec §5.4): `inline`, the default, keeps today's in-process desk (unit tests, the
  `/v1/__test` scripted ticks, the E2E suites); a request that arrives after an inline fill finds nothing to do.
  `worker` (needs `QUOTE_SHARDS`) builds the desk with `followTicks: false`: it subscribes to no ticks, reads the
  adapter's current quote whenever an order action or a valuation needs a price (so a MARKET order fills at the live
  price), and fills resting orders only from the matcher's requests. apps/api then runs no 15 s sweep, so AMO
  release, square-off and day close run on each user's next request or fill until the E16 session jobs take them
  over. Try it with `MATCHER_MODE=worker npm run dev:api`.
- **Status:** the book, the worker, the order and stop commands, the reconcile loop (orders, and trailing stops
  with NSTOCK-0387), fills and `MATCHER_MODE` are built, and so are server-side trailing stops (NSTOCK-0368). The
  benchmark is NSTOCK-0370.

### Server-side trailing stops (NSTOCK-0368)
In api mode trailing stops run on the server with the same engine rules as the browser mock (SPEC-TFC-1 §6, §10.6).
- **Store:** the engine's working set is version 4: it carries the trailing stops (active ones and today's), the
  engine `seq`, the exit order ids and the stops' idempotency keys. Migration 0015 adds `trailing_stops` (one row per
  `TrailingStop`, trail as unit plus amount or basis points, CHECKed against the contract lists) and
  `paper_accounts.seq` and `exit_order_ids`. A commit upserts the stops that changed; a reset clears them with the
  orders. So a stop survives a restart, keeps its stop price, and `seq` never goes back.
- **Routes:** apps/api serves `GET/POST /v1/trailing-stops`, `PATCH/DELETE /v1/trailing-stops/:id`,
  `POST /v1/positions/close` and `GET /v1/account/state`, with refusals mapped by `trailingStopApiError` like the
  mock. Every action is audited (`TRAILING_STOP_PLACE`, `_MODIFY`, `_CANCEL`, `POSITION_CLOSE`) and every state change
  as `TRAILING_STOP_UPDATE`.
- **Frames:** after each commit the orders module publishes an `AccountDeltaEvent` (the changed orders and stops at
  their newest `seq`, positions and funds) on the user's order channel, after the order updates. apps/realtime sends it
  to that user's connections as an `accountDelta` frame with no quotes, so the web app's trading store runs in api mode
  exactly as on MSW: it loads the account state, applies frames, and reloads on a gap.
- **Matcher:** apps/api sends every committed stop change to the matcher as `STOP_ADD` or `STOP_CANCEL`. Until
  `MATCHER_MODE` hands the books to the worker, ticks still step stops in apps/api's own process.

### Market data and chart bars
- `packages/marketData` generates each range's own bars (1D: 1-minute, 1W: 5-minute, 1M: hourly,
  1Y: daily, 5Y: weekly) and `resampleCandles` groups them into a coarser bar size on request
  (`?interval=1m|5m|15m|30m|1h|1d|1w`, the allowed sizes per range are `CANDLE_INTERVALS` in
  `packages/contracts`). An unknown pair, such as 1D with weekly bars, is a 400.
- Intraday bars start at the 9:15 IST open (`sessionBarStart` in `packages/utils`), as NSE charts do.
  The web chart keeps the bar size in the URL and folds live ticks into the current bar of that size.
- On the full stack the API serves stored bars from TimescaleDB (next section); the contract stays.
  The mock backend (MSW) and the memory driver keep the generated bars.

### Candle store (Wave 3, E25)
Spec `market-data-and-matching.md` §7. Chart bars are stored, so the 1-minute bar a user watched form is the bar
the chart shows after a reload.
- **Database:** Compose, CI and Testcontainers run `timescale/timescaledb:2.17.2-pg16` (Postgres 16 with the
  Apache core and the free community features). Migration `0014_timescaledb_candles` (hand-written, like the
  partitioned orders) creates the extension as `nthstock_owner`; `nthstock_app` may read and upsert bars, never
  delete them or run DDL.
- **Storage:** `candles_1m (token, bucket, open, high, low, close, volume)`, prices in paise, primary key
  `(token, bucket)`, a hypertable in 1-day chunks, compressed by `token` after 7 days.
- **Aggregates:** `candles_5m`, `candles_15m`, `candles_30m`, `candles_1h` and `candles_1d` are continuous
  aggregates on `time_bucket(…, origin => 09:15 IST)`, so bars start at the NSE open and a daily bar is one
  session. Each has a refresh policy of one bucket (window of three, so a replayed minute is folded in) and
  real-time aggregation on, so a read includes minutes not yet materialised. Weekly bars group `candles_1d`.
- **Writer:** the candle writer (`apps/api/src/candleWriter.ts`) reads the tick streams in its own consumer group
  and keeps each instrument's forming bar in memory. On a minute boundary it writes every closed bar of that minute
  in one multi-row `INSERT … ON CONFLICT (token, bucket) DO UPDATE`, records the minute as written, and only then
  acknowledges the stream entries, so a restart re-reads what was not stored: no minute is lost and a replayed one
  overwrites itself with the same values.
- **History:** `npm run db:seed:candles` (also run by `seed:demo`) writes 2 years of daily bars and 30 days (at least
  22 sessions) of 1-minute bars from the deterministic generator, so charts have depth on day one and every machine
  stores the same rows. Because `candles_1d` aggregates `candles_1m`, a day older than the minute window is stored
  as one 09:15 IST row carrying that day's OHLCV. Minute bars go to the indices and their large-cap members
  (66 instruments, about 577k rows, 23 s locally); `--all` adds daily history for every symbol. The seed must refresh
  the aggregates as the owner (`DATABASE_MIGRATION_URL`; the app role may not): real-time aggregation only covers
  minutes after an aggregate's watermark, so history never materialised would drop out once a policy runs. One-row
  days are inserted only where nothing is stored, so a later seed keeps the minute bars of sessions that left the
  window.
- **Running the writer:** `npm run dev:candles -w @nthstock/api` beside `npm run dev:api` (one process per
  deployment: it uses a fixed consumer name).
- **Reads:** `GET /v1/market/instruments/:symbol/candles` reads 1-minute bars from the hypertable, 5 minutes to an
  hour and daily bars from the aggregates, weekly bars by grouping the daily ones, and finishes the forming bar with
  the live price from the quote snapshot. A symbol with no stored bars in the window (not seeded, or only daily
  history on an intraday range) keeps the generated bars, so nothing regresses.
- **Schema check:** `db:check` with `DB_CHECK_URL` compares a migrated database with the schema files and the
  hand-written relations, skipping TimescaleDB's catalog, chunks and internal schemas; CI runs it.
- **AWS (Phase 6):** RDS does not offer TimescaleDB; the spec's open question 1 decides between self-managed
  Postgres on EC2, Timescale Cloud, or native partitions with rollup tables. The queries are plain `time_bucket`
  reads, so the fallback is contained.

### Price alerts and notifications
Spec `market-data-and-matching.md` §6 (E24, NSTOCK-0379 to 0385). The mock backend keeps `AlertDesk`
(`packages/paperEngine/src/alertDesk.ts`) in the browser; api mode stores everything in Postgres.
- **Notifications** (NSTOCK-0379): a `notifications` row (migration 0017; kinds `PRICE_ALERT`, `ORDER_FILLED`,
  `ORDER_REJECTED`, `TRAILING_STOP`, `AMO_RELEASED`, `SQUARED_OFF`, `SECURITY`) is written in the same
  transaction as its cause: the account store derives fill, rejection, AMO release, square-off and trailing stop
  notices from each order change (`orders/changeNotifications.ts`) and appends them beside the audit entries. The
  newest 100 per user are kept. Bodies are built from contract types and never hold a mobile number or a name.
- **Outbox** (NSTOCK-0379): each row gets a `notification_outbox` row in the same transaction. After commit apps/api
  publishes a `NotificationEvent` on `nthstock:notify:v1:{userId}` and clears the outbox row; a relay publishes
  rows older than 5 s every 5 s, so a crash or a Redis outage only delays delivery. Delivery is at least once and
  the web app drops an id it already holds.
- **Fan-out** (NSTOCK-0379): apps/realtime subscribes each connected user's notify channel beside their order
  channel and sends `{ type: 'notification' }` to that user's sockets only; an event whose `userId` does not match
  its channel, or that fails the contract, is dropped.
- **Price alerts** (NSTOCK-0383): alerts live in `price_alerts` (migration 0018), at most 50 active per user. A
  firing is one transaction, `UPDATE … WHERE status = 'ACTIVE' RETURNING` plus the notification and its outbox
  row, so an alert fires exactly once whoever sees the tick first. apps/api watches the active alerts' instruments
  (reloaded at start) and sends `ALERT_ADD` and `ALERT_CANCEL` to the shard's matcher command stream; the matcher
  holds alerts on its `OrderBook` in two price heaps (ABOVE lowest first, BELOW highest first), reloads the active
  ones every 60 s, and fires through the same transaction, then publishes. A level the price has already passed is
  refused; a gap fires with the LTP that crossed it.
- **Security notices** (NSTOCK-0382): a sign-in from a new device, two-factor turned on or off, and logging out the
  other sessions raise a `SECURITY` notification naming the device type and the IST time ("Not you? Change your
  PIN."). Raising one never fails the action it reports.
- **Web** (NSTOCK-0384): the bell and the toasts update from the socket push with no poll; a pushed id already held
  is dropped, and the list and the alerts are re-read after a reconnect. Routes: `/v1/alerts` (GET, POST),
  `/v1/alerts/:id` (DELETE), `/v1/notifications` (GET), `/v1/notifications/read` (POST).

### Two-factor authentication and step-up
- TOTP is RFC 6238 (HMAC-SHA1, 6 digits, 30 s step, ±1 step) in `packages/utils/src/totp.ts`, on
  Web Crypto, so apps/api and the MSW mock compute the same codes with no library. Any authenticator
  app reads the `otpauth://` URI (a QR code drawn as one SVG path; `qrcode` is loaded only on the
  Security page) or the grouped setup key.
- Secrets are stored encrypted (`totp_factors.secret_enc`, PII envelope keyed per user);
  `last_used_step` refuses a replayed code. Ten single-use recovery codes are stored only as hashes
  (`totp_recovery_codes`) and shown once, with Copy and Download.
- Login: an OTP or PIN login for a user with two-factor on answers 401 `TOTP_REQUIRED` with a
  5-minute challenge (Redis in api mode); `POST /v1/auth/totp/verify` takes the code or a recovery
  code and issues the session. Five wrong codes end the challenge.
- Step-up: sensitive routes (turning two-factor on or off, new recovery codes) answer 403
  `STEP_UP_REQUIRED` unless the session re-proved the user in the last 10 minutes with the PIN or
  a `STEP_UP` OTP to the own mobile (`/v1/auth/step-up/otp`, never usable as a login), plus the
  code when two-factor is on. The web app's `useStepUp` opens one shared dialog and retries the
  action once. Every change is in the audit log (`STEP_UP`, `TOTP_ENABLED`, `TOTP_DISABLED`,
  `RECOVERY_CODE_USED`, `RECOVERY_CODES_REGENERATED`).

### Active sessions
- `GET /v1/auth/sessions` lists the user's live sessions (neither revoked nor expired), most
  recently active first, each with its device label (`deviceLabel` in `packages/utils`, shared by
  both backends, never the raw user agent), the trusted flag and `current`. No IP address is stored
  or shown.
- `DELETE /v1/auth/sessions/:id` and `POST /v1/auth/sessions/revoke-others` need a step-up. Each
  revoke goes through `SessionService.revoke`: the row is marked `USER_REVOKED`, audited as
  `SESSION_REVOKED` and published on `auth:sessionRevoked`, so that session's access and refresh
  tokens answer 401 at once and apps/realtime closes its sockets. The current session is refused
  (400); it logs out from the profile menu.
- Turning two-factor on or off offers "Log out all other devices" (ASVS 3.3.3).

### Consent and account deletion (DPDP Act 2023)
- Consent: the first OTP login sends `consentVersion` (`CONSENT_POLICY_VERSION` in
  `packages/contracts`). A sign-up without the current version answers 400 `CONSENT_REQUIRED`; the
  user and its `consents` row (purpose `TERMS_AND_PRIVACY`, policy version, time) are written in one
  transaction, then `CONSENT_GRANTED` is audited. Existing users are not asked again.
- Deletion: `POST /v1/account/deletion` (`{ confirm: 'DELETE' }`, step-up) runs
  `accountDeletionService`: mark the user deleted with `purge_after` = now + 30 days (so no login
  can start a session), revoke every live session with reason `ACCOUNT_DELETED` (audited and
  published, so tokens and sockets end at once), cancel OPEN and AMO paper orders, and audit
  `ACCOUNT_DELETION_REQUESTED`. The response clears the auth cookies.
- Until the purge, an OTP login for the mobile answers 403 `ACCOUNT_DELETED` with `purgeAfter`, and
  `findById` hides the user from every read. The purge job (T-230, with the BullMQ jobs of E16)
  erases the PII columns and leaves a tombstone; the mobile can then sign up as a new user.
- Web: Settings, Security has a danger card (DELETE typed, then step-up). On success the app
  navigates to `/login?deleted=<purgeAfter>` first (its `beforeLoad` skips the session check), then
  clears the session, the query cache and the trusted-browser record.

### Background jobs (Phase 2, E16)
Spec `backend-core.md` §3 and §9, ADR 0007 §11. Code: `apps/api/src/modules/jobs/`, entry `apps/api/src/worker.ts`.
- **Worker:** the same codebase as the API with another entry (`npm run worker -w @nthstock/api`; `npm run dev:api`
  starts it as `dev:worker` with `JOBS_MODE=bullmq`), so jobs share the repos, the paper engine and the quote-service prices.
  It publishes the order updates its jobs make, and sends them to the matcher as the API does.
- **`JOBS_MODE`:** `inline` (default) keeps the API's in-process order sweep, which unit tests and the `/v1/__test`
  clock routes drive; `bullmq` (needs `DB_DRIVER=postgres`) turns the sweep off and leaves session events to the
  worker; `off` runs neither. Lazy sync stays either way: every read syncs the engine first.
- **Schedules (IST, BullMQ job schedulers with `tz: 'Asia/Kolkata'`):** `session.amoRelease` 09:15,
  `session.squareOff` 15:20, `session.dayClose` 15:30 and `pnl.snapshot` 15:45 on trading days (each checks the NSE
  holiday table in `packages/utils` and exits on a holiday or weekend); `db.orderPartitions` 00:30 and
  `auth.tokenCleanup` 03:00 daily. `account.purge` (02:00) is scheduled once T-230 adds it.
- **Jobs are plain functions:** each is `run(at, deps)`, unit-tested with a fixed clock; BullMQ only schedules and
  retries it (3 attempts, exponential backoff from 30 s). `at` is the run's due time, not when it started.
- **Idempotency:** a session job reloads each account from Postgres, syncs it to now and commits against its
  version (`OrderService.syncAccounts`), so a rerun, a retry or the API committing the same event first changes
  nothing twice. The snapshot upserts on `(user_id, trade_date)`, partitions use `CREATE TABLE IF NOT EXISTS`, the
  cleanup is a plain delete. The job id (scheduler id plus due time) keeps one run per scheduled time across workers.
- **P&L snapshot:** one `pnl_snapshots` row per account touched today or holding stock: invested, current value
  and day P&L over holdings (from the portfolio summary), total P&L (current value − invested) and realised P&L
  since the account opened or was reset (the close clears the day's realised figure, so a day's realised P&L is the
  difference between two snapshots).
- **Shutdown:** SIGTERM closes the worker, which waits for the running job, then flushes audit writes and order
  updates and closes the pools.
- **No PII in logs:** a run's result is counts only, and a failure is logged as job, attempt and error class; a
  Postgres error's `detail` (row values) is dropped.

### OpenAPI (E20)
- `packages/contracts/src/openapi.ts` builds an OpenAPI 3.1 document from the route map with Zod 4's
  `z.toJSONSchema()` (no extra library): one operation per route (`operationId` = route key,
  `x-auth` = its auth), path and query parameters and bodies as the client sends them, responses as
  it receives them, the `ApiError` response on every route, and `cookieAuth` (the `nth_at` cookie
  plus the CSRF header) and `bearerAuth` security schemes. Response types are named component
  schemas taken from the contracts' exports.
- `apps/api` serves it at `GET /v1/docs/openapi.json` (outside the route map, public,
  `Cache-Control: public, no-cache` with an ETag, so a revalidation is a 304). No Swagger UI (spec backend-core §2).
- `npm run openapi` writes the same text to `docs/api/openapi.json`. CI regenerates it, uploads it
  as the `openapi` artifact and fails when the committed copy is stale; the docs route test checks
  the same thing in `npm run check`. A new route in the map joins with no extra wiring: regenerate
  and commit the file.

### Demo mode and Try demo (TFC-12, REQ-DEL-02)
The hosted site is the msw-mode build: the mock backend runs in the browser's service worker
(`apps/web/src/mocks/browser.ts`) and each tab keeps its own paper account in sessionStorage.
- **Demo mode** is a sessionStorage flag (`nthstock.demoMode`). It loads the demo account
  (watchlists, holdings, ledger from `@nthstock/paperEngine`) and registers the Demo simulator,
  whose Rally, Pull back and Gap buttons move one instrument's feed, so every screen sees the same
  move. The instrument page shows it on desktop and on the phone layout, labelled "Simulated".
- **`?demo=1`** turns it on at load: the seed is written before the mocks read their saved state.
- **Try demo** on /login gives the same thing from a cold load. Outside demo mode it reloads to
  `/login?demo=1` with a pending flag, then logs in as the demo user and opens RELIANCE without a
  second tap (`startDemo` in `shared/lib/demoSimulator.ts`, `TryDemo.tsx`). In api mode nothing
  registers a starter, so Try demo only logs in.
- **Walkthrough video:** a Playwright script plays the five journeys on a 390 px touch phone
  against the production build and encodes `public/demo/walkthrough.mp4`
  (`docs/runbooks/demo-walkthrough.md`).

### Phase 2 sign-off (E21)
- Demo seed: with `DB_DRIVER=postgres`, `DEMO_SEED=true` writes the demo user (upserted by the
  mobile's blind index), their terms and privacy consent (`UsersRepo.ensureConsent`, idempotent),
  the demo watchlists and the paper account (through the account store) to Postgres. Seeding twice
  or across a restart gives the same state (`seed.integration.test.ts`), equal to MSW's `?demo=1`.
- Local stack: `npm run dev:api` starts Postgres and Redis, migrates, then runs apps/api,
  apps/realtime, apps/quotes, the web app and the BullMQ jobs worker (`JOBS_MODE=bullmq`);
  `db:psql` and `db:reset` cover the chores (`docs/runbooks/local-demo.md`).
- Proof: the api-mode Playwright job restarts apps/api mid-test and still sees the session,
  watchlists, orders and holdings; the security settings journey (TOTP on, log in with TOTP, log out
  another session, delete the account, axe on every step) runs in msw and api mode; a performance
  smoke times order acks and PIN logins on 10,000 seeded users (first CI run: order ack p95
  29.6 ms, PIN login p95 42.1 ms, slowest query p95 0.6 ms; budgets 300, 200 and 50 ms).
- The ASVS L2 checklist with links to every test and the owner sign-off list:
  [`docs/security/phase2-asvs-l2.md`](security/phase2-asvs-l2.md).

### Security baseline
- Rate limits per IP and per user; OTP resend throttling; CAPTCHA after 3 failed OTP/PIN attempts; PIN lockout after 5, unlock via OTP.
- TLS 1.2+ and HSTS; encryption at rest (KMS); phone/PII column-level encryption.
- Strict CSP, X-Frame-Options DENY, CSRF tokens on state-changing requests.
- Append-only audit log for logins, orders, fund movements.
- `.env` locally (only `.env.example` committed); AWS Secrets Manager in cloud.
- CI: Dependabot, `npm audit`, CodeQL, gitleaks.

### Contract tests (E20)
- `apps/api/src/test/contract.test.ts` walks the route map: every route is registered in Fastify
  with the same method and path, `user` routes answer 401 with an `ApiError` body without a session
  and `public` ones do not (the one listed exception is `sessionRefresh`, which needs its cookie),
  and nothing under `/v1` is registered outside the map apart from `ROUTES_OUTSIDE_THE_MAP` (the
  OpenAPI document and the test controls). `findContractGaps` names the route key on a gap.
- `contractChecked(backend)` in `packages/contracts/src/testing` wraps every scenario backend
  (app.inject, apps/api on Postgres + Redis, the MSW node server). Each response, raw sends
  included, must parse with its route's response schema on 2xx and with `ApiError` otherwise.
- `apps/web/src/mocks/routeParity.test.ts`: every route in the map has an MSW handler.
- All three iterate the map, so a route added by any epic joins with no wiring.

### Observability
OpenTelemetry → Grafana (Prometheus, Loki, Tempo); Sentry for frontend errors; real-user Web Vitals with regression alerts.

## 5. Monorepo structure

npm workspaces + Turborepo. Node 22 pinned in `.nvmrc`; `.npmrc` sets `engine-strict=true` and
`save-exact=true`. Updated 2026-10-07.

```
nthstock/
├── CLAUDE.md                     # short project memory for Claude; links everything below
├── apps/
│   ├── web/                      # Vite React SPA (ADR 0005)
│   │   ├── e2e/                  # Playwright specs (msw and api mode, perf)
│   │   ├── public/               # static files, MSW worker (generated)
│   │   ├── scripts/              # post-build budget checks and guards (no raw hex, import boundaries)
│   │   └── src/
│   │       ├── main.tsx          # boot: runtime config, mocks, providers, router
│   │       ├── app/              # app-wide wiring, never imported by features
│   │       │   ├── config/       # runtime config, dev proxy, security headers
│   │       │   ├── layouts/      # AppShell, Header, LeftRail
│   │       │   ├── live/         # live quotes socket, background-tab sync
│   │       │   ├── providers/    # AppProviders and contexts
│   │       │   ├── router/       # router factory and route guards
│   │       │   ├── store/        # app-shell UI state (Zustand)
│   │       │   ├── queryClient.ts
│   │       │   └── strings.ts
│   │       ├── routes/           # TanStack Router file routes; thin: loader prefetch → feature page
│   │       ├── features/<feature>/
│   │       │   ├── index.ts      # the only import surface of the feature
│   │       │   ├── strings.ts    # every UI string of the feature
│   │       │   ├── api/          # query keys, queries and mutations
│   │       │   ├── components/   # PascalCase .tsx, tests beside them
│   │       │   ├── hooks/        # useX.ts
│   │       │   ├── model/        # pure logic and types
│   │       │   └── store/        # Zustand slices (only when needed)
│   │       ├── shared/           # cross-feature components, hooks, lib
│   │       ├── mocks/            # MSW handlers and the in-browser mock market
│   │       ├── styles/           # global CSS (token imports, Tailwind base layer)
│   │       └── test/             # render wrappers, fixtures, browser API stubs
│   ├── api/                      # Fastify modular monolith
│   │   ├── drizzle/              # SQL migrations (NNNN_name.sql) and Drizzle metadata
│   │   └── src/
│   │       ├── app.ts            # buildApp: plugins, modules, error handler
│   │       ├── server.ts         # process entry
│   │       ├── config.ts         # env parsing (Zod)
│   │       ├── deps.ts           # storage seams: in-memory or Postgres repos
│   │       ├── db/               # Postgres client, migrations runner, column crypto
│   │       │   └── schema/       # Drizzle tables, one file per area
│   │       ├── http/             # errors, cookies, CSRF, security headers, route registration
│   │       ├── modules/<module>/ # index.ts (public API), routes.ts, service.ts, repo.ts
│   │       │                     # (interface + memory), pgRepo.ts (Postgres), schema.ts, tests
│   │       │                     # beside them; others import a module only via index.ts
│   │       ├── ticks/            # mock tick pump and quote publisher
│   │       └── test/             # injected backend, test Postgres/Redis, cross-module suites
│   ├── quotes/                   # tick writer: one process per shard behind a Redis lease (Wave 3, E22)
│   ├── realtime/                 # WebSocket server
│   │   └── src/
│   │       ├── app.ts, server.ts, config.ts, logger.ts, protocol.ts, timers.ts
│   │       ├── connections/      # auth, per-connection hub, subscription registry
│   │       ├── feeds/            # Redis quote, order and session-revocation feeds
│   │       └── test/             # fake sockets, WS test client, test Redis
│   └── mobile/                   # (later) React Native + Expo
├── packages/                     # each: src/index.ts is the public API; tests beside the code
│   ├── ui/                       # design system components + Storybook
│   ├── tokens/                   # design tokens → CSS variables + Tailwind theme
│   ├── contracts/                # Zod schemas, REST routes, WS messages
│   ├── marketData/               # feed adapters: mock (faker + GBM), vendor (later)
│   ├── paperEngine/              # order state machine, fills, funds ledger, P&L (ADR 0004)
│   ├── apiClient/                # typed REST + WS client (web and mobile)
│   ├── config/                   # eslint, tsconfig, prettier, vitest presets
│   └── utils/                    # INR formatting, market hours, IST dates
├── infra/                        # docker-compose, k6, (later) terraform
├── tools/github/                 # issueKey.sh: NSTOCK issue keys for agents and workflows
├── docs/                         # see docs/README.md
├── .claude/                      # see "Claude Code setup" in CLAUDE.md
└── .github/                      # workflows, PR template, CODEOWNERS, Dependabot
```
