# 0004. Mock backend and paper-trading engine

- Status: Proposed (needs owner approval)
- Date: 2026-09-25

## Context

v1 is paper trading on simulated market data (D2, D3). The build goal is the UI and a mock backend
working end to end: log in → watchlist → stock detail → place order → order book → positions and
holdings (Document 3). Two needs pull in different directions:

- UI stories must move fast without a running server. That points to MSW in the browser.
- The mock must become the real backend later (Phase 3–5) without a rewrite. That points to the
  Fastify `apps/api` and the separate WebSocket server `apps/realtime` (D5).

If market simulation and order matching lived in two places (MSW handlers and `apps/api`), the two
modes would drift apart and tests would disagree.

## Decision

1. **Two interchangeable modes behind one switch.** `VITE_API_MODE=msw|api`.
   - `msw`: MSW handlers in the browser for REST and WebSocket. This is the default for UI work,
     Storybook and component tests.
   - `api`: the web app talks to `apps/api` (REST `/v1`) and `apps/realtime` (WebSocket). This is the
     default for end-to-end tests and the demo.
   Both modes serve the same contracts from `packages/contracts` (Zod), including one REST route map
   that MSW, Fastify and `packages/apiClient` all use.

2. **Simulation and matching are isomorphic packages** that run unchanged in the browser (inside MSW)
   and in Node (inside `apps/api`). They have no Node-only or DOM-only imports, and time and
   randomness are injected.
   - `packages/marketData`: a `MarketDataAdapter` interface plus a `MockMarketDataAdapter`. It holds a
     seeded symbol master (about 5,000 equities and the major indices), GBM random-walk ticks in paise
     on a 5-paise tick with ±20% circuit bands, candles, top-5 depth, curated lists, movers, search,
     and NSE hours and holidays from `packages/utils`. A licensed vendor adapter can replace it later.
   - **New** `packages/paperEngine`: a pure order engine. It validates orders, runs the order state
     machine (AMO, OPEN, EXECUTED, CANCELLED, REJECTED) and matches fills: MARKET orders at the last
     price, LIMIT orders when the price crosses the limit. It also keeps the funds ledger (₹10,00,000
     opening credit, block on place, release on cancel, settle on fill, append-only) and computes
     position and holding P&L. All money is integer paise.

3. **Storage in the mock phase is in memory**, behind a `repo.ts` interface per API module, with a
   seeded demo user. Postgres and Drizzle replace these repos in Phase 3 with no changes to the modules.

4. **Realtime path in `api` mode:** `apps/api` publishes adapter ticks to Redis pub/sub. `apps/realtime`
   subscribes and fans out only the subscribed symbols to each connection. Output is conflated to 4
   updates/sec/symbol and batched into one frame per flush, using a compact binary quote frame (JSON
   for control messages). Redis 7 runs locally in Docker Compose (`infra/docker-compose.yml`).

5. **New dependencies requested with this ADR:**

   | Package | Used by | Why |
   |---|---|---|
   | `msw` | apps/web (dev, tests) | Mock REST and WebSocket in the browser and in Vitest |
   | `@faker-js/faker` | packages/marketData | Company names for the symbol master (already named in D3) |
   | `ws` | apps/realtime | The standard, fastest-maintained Node WebSocket server |
   | `ioredis` | apps/api, apps/realtime | Redis pub/sub client |
   | `@fastify/cookie`, `@fastify/jwt` | apps/api | Session cookie and access token (E3) |
   | `argon2` | apps/api | PIN hashing (CLAUDE.md §4, Argon2id) |

## Consequences

- A UI story needs no server. `npm run dev` runs in `msw` mode, and `npm run dev:api` starts Redis,
  api, realtime and web.
- The same scenario tests run against both modes (MSW node server and Fastify `app.inject`), so drift
  between them fails CI.
- `packages/paperEngine` is a new package not listed in CLAUDE.md §5. CLAUDE.md gets updated when this
  ADR is accepted.
- In-memory state resets on restart. That's acceptable for paper trading in v1, and the reset-balance
  feature relies on it.
- Simulated prices are clearly labelled as simulated in the UI. No real market data is used or
  redistributed (CLAUDE.md §9).
