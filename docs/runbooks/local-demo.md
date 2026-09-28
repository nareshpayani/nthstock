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

## api mode (apps/api, apps/realtime, Redis)

Needs Docker for Redis and Postgres (`npm run infra:up` and `npm run db:migrate`, run for you).

```bash
MOCK_MARKET_ALWAYS_OPEN=true npm run seed:demo
```

`npm run seed:demo` is `npm run dev:api` with `DEMO_SEED=true`: apps/api loads the demo watchlists
and paper account for the demo user as it starts, then serves requests. apps/api keeps its state
in memory until Phase 3 (Postgres), so the seed is applied at start-up rather than written to a
database, and a restart of apps/api (including a `tsx watch` reload after a code change) seeds
again from the same starting state.

1. Open <http://localhost:5173/dashboard>.
2. Log in with **9000000001** and OTP **123456** (apps/api also prints the OTP), then "Skip for now".

apps/api refuses `DEMO_SEED=true` with `NODE_ENV=production`.

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
| Prices do not move | Outside NSE hours: set `VITE_MOCK_MARKET_OPEN=true` (msw) or `MOCK_MARKET_ALWAYS_OPEN=true` (api). |
| Live prices stop in api mode, WebSocket closes with 4401 | The access token expired or apps/api and apps/realtime have different `JWT_SECRET`s; log in again, or let `npm run seed:demo` generate one key for both. |
