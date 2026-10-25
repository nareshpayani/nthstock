# Local demo

How to run nthstock locally with a ready-made demo account, in either mode. Both modes start from
the **same state** (T-174): the state is defined once in
[`packages/paperEngine/src/demoSeed.ts`](../../packages/paperEngine/src/demoSeed.ts), and unit
tests on both sides (`apps/api/src/modules/demo/seed.test.ts`,
`apps/web/src/mocks/demoSeed.test.ts`) check the REST answers against it.

Everything here is paper trading on a simulated market. No real money, no real market data, no
real person: the demo mobile number is made up.

## What the demo account has

| | |
| --- | --- |
| Login | mobile **9000000001**, OTP **123456** (the dev OTP; works only outside production) |
| User | "Demo Investor", KYC verified, no PIN yet (the app offers to set one; "Skip for now" is fine) |
| Watchlists | **My Watchlist**: RELIANCE, HDFCBANK, TCS, INFY, ITC, BHARTIARTL; **Banks**: ICICIBANK, SBIN, KOTAKBANK, AXISBANK, BAJFINANCE |
| Holdings | RELIANCE 20, INFY 20, HDFCBANK 40, TCS 10, ITC 150 (delivery buys from 15 to 22 Sep 2026) |
| Ledger | opening credit of ₹10,00,000, a block, release and debit per buy, and a credit for selling 10 INFY on 24 Sep 2026 |
| Orders | the six executed orders behind the holdings |

Fill prices are fixed percentages of each stock's simulated base price, so profit and loss move
with the live mock market once the app is open.

## msw mode (no backend)

Everything runs in the browser: MSW answers REST and the live-price WebSocket.

```bash
VITE_MOCK_MARKET_OPEN=true npm run dev -w @nthstock/web
```

1. Open <http://localhost:5173/dashboard?demo=1>.
2. Log in with **9000000001** and OTP **123456**, then "Skip for now" on the PIN step.

`?demo=1` writes the demo watchlists and account into this tab's sessionStorage (where the MSW
mocks keep their state) and is then removed from the address bar, so a reload keeps whatever you
changed. Open any page with `?demo=1` again to go back to the starting state. Other users' state in
the tab is left alone. A new browser tab starts without the demo until you add `?demo=1`.

`VITE_MOCK_MARKET_OPEN=true` keeps prices ticking outside NSE hours; leave it out to follow the real
market clock (orders placed while the market is closed become AMOs).

## api mode (apps/api, apps/realtime, Postgres, Redis)

Needs Docker for Postgres and Redis. Nothing else to install: the commands below start the
containers, migrate the database and seed it for you.

```bash
MOCK_MARKET_ALWAYS_OPEN=true npm run seed:demo
```

`npm run seed:demo` runs `npm run infra:up` (Postgres 16 with TimescaleDB and Redis 7, loopback
only), `npm run db:migrate` (as `nthstock_owner`), `npm run db:seed:candles`, then
`npm run dev:api` with `DEMO_SEED=true`. `npm run dev:api` starts apps/api, apps/realtime,
apps/quotes, the web app and the BullMQ jobs worker (`npm run dev:worker -w @nthstock/api`, with
`JOBS_MODE=bullmq`), so the market-hours jobs, P&L snapshots and the account purge run as they
would in production. As apps/api starts it writes the demo user, their terms
and privacy consent, the demo watchlists and the paper account to Postgres (NSTOCK-0239). The
user is upserted by the mobile's blind index and the rest is replaced, so seeding again gives the
same state, and a restart of apps/api (including a `tsx watch` reload) keeps whatever you changed
until the next seed. Use `npm run dev:api` (no seed) to keep your changes across restarts.

1. Open <http://localhost:5173/dashboard>.
2. Log in with **9000000001** and OTP **123456** (apps/api also prints the OTP), then "Skip for now".

apps/api refuses `DEMO_SEED=true` with `NODE_ENV=production`.

### From a fresh clone

```bash
nvm use                 # Node 22 (.nvmrc)
npm install
npm run infra:up        # Postgres + Redis containers, waits for their health checks
npm run db:migrate      # schema as nthstock_owner
MOCK_MARKET_ALWAYS_OPEN=true npm run seed:demo
```

### Database chores

| Task | Command |
| --- | --- |
| Start or stop the containers | `npm run infra:up` / `npm run infra:down` (data stays in the `postgres-data` volume) |
| Apply new migrations | `npm run db:migrate` |
| Check the schema matches the migrations | `npm run db:check -w @nthstock/api` |
| Open psql as the app role | `npm run db:psql` |
| Start again from an empty database | `npm run db:reset` (deletes the local volume, then migrates) |
| Re-seed the demo user only | `MOCK_MARKET_ALWAYS_OPEN=true npm run seed:demo` |

Dev keys: `npm run dev:api` makes a fresh `JWT_SECRET` per run (shared by apps/api and
apps/realtime) unless you set one, and apps/api uses fixed, non-secret development keys for PII
encryption (`PII_ENC_KEYS`, `PII_HMAC_KEY`) outside production; production refuses to start
without real ones. The role passwords are listed in [`infra/README.md`](../../infra/README.md).

## Checking both modes agree

```bash
npm run test -w @nthstock/api -- src/modules/demo
npm run test -w @nthstock/web -- src/mocks/demoSeed.test.ts
npm run e2e -w @nthstock/web -- e2e/demo.spec.ts
```

The two unit tests log the demo user in on each backend and compare watchlists, holdings, the
funds ledger, available cash and orders with the shared builders (`demoWatchlists`,
`buildDemoAccount`). The Playwright spec opens `?demo=1` in the browser and checks the holdings and
watchlists on screen.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| msw mode shows an empty "My Watchlist" | The URL lacked `?demo=1`, or sessionStorage is blocked (the console says "Demo seed skipped"). |
| api mode shows no holdings | apps/api was started without `DEMO_SEED=true`; use `npm run seed:demo`. |
| `db:migrate` fails with "could not access file timescaledb" | The volume was made by the old `postgres:16-alpine` image; run `npm run db:reset` once. |
| apps/api answers 503 on `/v1/health/ready` | Postgres or Redis is down; `npm run infra:up`. |
| Prices do not move | Outside NSE hours: set `VITE_MOCK_MARKET_OPEN=true` (msw) or `MOCK_MARKET_ALWAYS_OPEN=true` (api). |
| Live prices stop in api mode, WebSocket closes with 4401 | The access token expired or apps/api and apps/realtime have different `JWT_SECRET`s; log in again, or let `npm run seed:demo` generate one key for both. |
