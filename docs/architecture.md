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
- Drizzle ORM, PostgreSQL 16, Redis 7, BullMQ jobs (EOD settlement, P&L snapshots).
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
  replayed command never undoes a newer one; malformed entries are logged and skipped. `STOP_ADD` and
  `STOP_CANCEL` are in the contract and applied by the worker; apps/api sends them with server-side trailing stops.
- **Reconcile** (NSTOCK-0366): on start and every 60 s the matcher reads its shard's OPEN LIMIT orders and the
  account versions from Postgres in one REPEATABLE READ snapshot, through the `orders_shard_live_idx` partial
  index on `orders.shard` (migration 0016, set on insert as `shardOf(token, QUOTE_SHARDS)`). It upserts every
  live order and takes off any order Postgres no longer has live, each at the account version, so a lost command
  is repaired within a minute while a command newer than the read stands. An upsert at the same price keeps the
  order's heap entry, so the rounds leave nothing stale. Rows from before the column are matched by token.
- **Status:** the book, the worker, the order commands and the reconcile loop are built. Fills, server-side
  trailing stops, `MATCHER_MODE` and the benchmark are NSTOCK-0367 to 0370; until then the worker only logs what a
  tick crossed.

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
- **Matcher:** ticks still step stops in apps/api's process. Once the matcher worker (NSTOCK-0364, 0365) is on
  `develop`, apps/api sends `STOP_ADD` and `STOP_CANCEL` to it instead.

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
- `AlertDesk` (`packages/paperEngine/src/alertDesk.ts`) runs in both backends beside the paper desk:
  it subscribes to an instrument only while an active alert needs it, fires an ABOVE or BELOW alert
  once on the first tick at or past its level (a gap fires with the LTP that crossed), and refuses a
  level the price has already passed.
- Fired alerts, executed orders and triggered trailing stops add notifications (newest 100 per user,
  with a read flag). Routes: `/v1/alerts` (GET, POST), `/v1/alerts/:id` (DELETE),
  `/v1/notifications` (GET), `/v1/notifications/read` (POST); at most 50 active alerts per user.
- Delivery: the mock socket sends a `notification` message to the owner at once; in api mode the
  client polls every 30 s until apps/realtime carries notifications (the notifications service of
  Phases 3 to 5). The web app toasts a fired alert on any page and draws active alerts as dotted
  price lines on the chart.

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

### Security baseline
- Rate limits per IP and per user; OTP resend throttling; CAPTCHA after 3 failed OTP/PIN attempts; PIN lockout after 5, unlock via OTP.
- TLS 1.2+ and HSTS; encryption at rest (KMS); phone/PII column-level encryption.
- Strict CSP, X-Frame-Options DENY, CSRF tokens on state-changing requests.
- Append-only audit log for logins, orders, fund movements.
- `.env` locally (only `.env.example` committed); AWS Secrets Manager in cloud.
- CI: Dependabot, `npm audit`, CodeQL, gitleaks.

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
