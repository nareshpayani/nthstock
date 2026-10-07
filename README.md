# nthstock

An Indian stock-market investing and paper-trading platform on mock NSE/BSE data: a React SPA, a
Fastify API and a realtime WebSocket server. Paper trading only; no real money.

Start with [CLAUDE.md](./CLAUDE.md) for scope, decisions and conventions, and
[docs/README.md](./docs/README.md) for the product, architecture, ADRs, specs and runbooks.

## Getting started

Requires **Node 22** (`nvm use`, see `.nvmrc`). API mode also needs **Docker**.

```bash
npm install
npm run dev -w @nthstock/web   # web app on http://localhost:5173, mocked in the browser (no servers)
npm run dev:api                # web + apps/api + apps/realtime on Postgres and Redis (needs Docker)
npm run check                  # format, lint, typecheck, test, build (the CI quality gate)
npm run storybook              # design system on http://localhost:6006
npm run e2e                    # Playwright E2E (Chrome) in msw mode
```

**msw mode** (default): MSW mocks REST and the live-price WebSocket in the browser over the mock
market (`packages/marketData`). Prices tick only during NSE hours; to force the market open, run
`VITE_MOCK_MARKET_OPEN=true npm run dev -w @nthstock/web`. Web variables are in
[`apps/web/.env.example`](./apps/web/.env.example).

**api mode** (`npm run dev:api`) runs the real backend and needs **PostgreSQL 16** and **Redis 7**.
It runs `npm run infra:up` (Docker Compose: Redis on `127.0.0.1:6379` and Postgres on
`127.0.0.1:5432`), then `npm run db:migrate`, then apps/api (port 4000, `DB_DRIVER=postgres`),
apps/realtime (port 8081) and the web app with `VITE_API_MODE=api`. Vite proxies `/v1` and `/ws`, so
everything is same-origin. **PgBouncer** (transaction mode, `127.0.0.1:6432`) is optional, as in
production: start it with `docker compose -f infra/docker-compose.yml --profile pool up -d --wait`
and point `DATABASE_URL` at it. `npm run infra:down` stops the containers. Details, roles and
passwords: [infra/README.md](./infra/README.md).

In dev the OTP is always `123456`. Outside NSE hours use `MOCK_MARKET_ALWAYS_OPEN=true npm run dev:api`.
For a demo account, open the web app with `?demo=1` (msw mode) or run `npm run seed:demo` (api
mode); see [docs/runbooks/local-demo.md](./docs/runbooks/local-demo.md).

## Workspaces

| Workspace              | What it is                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `apps/web`             | Vite + React SPA (ADR 0005), msw or api mode                                          |
| `apps/api`             | Fastify modular monolith, REST `/v1`, one folder per module in `src/modules/` (below) |
| `apps/realtime`        | Live-price and order-update WebSocket server (`/ws`, port 8081)                       |
| `packages/apiClient`   | Typed REST client, live-quote WebSocket client and quote store                        |
| `packages/config`      | Shared ESLint and TypeScript config                                                   |
| `packages/contracts`   | Zod schemas for every REST route and WS message                                       |
| `packages/marketData`  | Market data adapters: seeded symbol master and the mock (GBM) tick feed               |
| `packages/paperEngine` | Paper-trading rules: orders, fills, funds ledger, P&L                                 |
| `packages/tokens`      | Design tokens → `tokens.css`, Tailwind v4 theme, self-hosted IBM Plex fonts           |
| `packages/ui`          | Design system components (Radix, cva, Tailwind) and Storybook                         |
| `packages/utils`       | INR formatting, IST dates, NSE market hours                                           |

apps/api modules: `audit`, `auth`, `demo`, `funds`, `health`, `market`, `orders`, `portfolio`,
`testControls`, `users`, `watchlists`.

Performance budgets (CLAUDE.md §3) are checked by `apps/web/scripts/checkBuild.mjs` on every build
and by the `@perf` E2E specs and Lighthouse CI (`npm run e2e:perf`, `npm run lhci -w @nthstock/web`).
