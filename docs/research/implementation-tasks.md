# Document 3: Implementation Task List

> Status: draft for owner review, 2026-09-25. Inputs: CLAUDE.md v0.3, Document 2
> (`docs/research/tech-stack-and-direction.md`), `docs/requirements-qa.md`, and the current code
> (`apps/web` placeholder, `apps/api` with `/v1/health`, `packages/config`). Document 1 (Paytm Money
> research) was still being written when this list was drafted; screen details it adds can be folded
> into the per-epic specs without reordering the list.

## How to use this list

**Build goal:** the UI and a mock backend working end to end:
log in → watchlist → stock detail → place order → order book → positions and holdings.
The mock backend has two interchangeable modes behind `VITE_API_MODE=msw|api`:

- `msw`: MSW handlers in the browser (REST and WebSocket), typed from `packages/contracts`.
- `api`: Fastify `apps/api` plus `apps/realtime` (WebSocket), running the same mock market-data
  adapter (faker symbol master, GBM ticks, NSE hours and holidays) and the same paper-trading engine
  (market orders fill at the last price, limit orders fill when the price crosses).

API shapes are nthstock's own contracts, not copies of Paytm Money's.

**Rules for working the list**

1. Work top to bottom. A task starts only when every ID in its `Depends:` field is done. Dependencies
   always point to earlier tasks.
2. One task per commit (Conventional Commits, e.g. `feat(watchlist): add reorder`). The Planner may
   group a few tasks into one story and PR.
3. Run `npm run check` (format, lint, typecheck, test, build) after every task. It must be green
   before the box is ticked.
4. Mark the task `[x]` in this file in the same PR that completes it.
5. Before the first task of an epic, its spec in `docs/specs/` must be approved by the owner
   (CLAUDE.md §8). Spec tasks are not repeated in this list.
6. Any dependency not already named in CLAUDE.md §4 (for example `@fastify/cookie`, `@fastify/jwt`,
   `argon2`, a WebSocket library, `@lhci/cli`) needs the owner's OK in the PR description before it
   is added.

**File format (machine-readable)**

- Each epic heading is `## E<n>: <title>`; each epic becomes a GitHub epic.
- Each task is one line:
  `- [ ] T-NNN [TRACK] Title. Depends: T-NNN, T-NNN. Done when: criteria.`
  `Depends:` lists explicit IDs (no ranges) or `none`.

**Track tags**

| Tag      | Meaning                                                                                                  |
|----------|----------------------------------------------------------------------------------------------------------|
| `[FE]`   | Frontend UI in `apps/web` or `packages/ui`                                                               |
| `[MOCK]` | Mock backend: `packages/marketData`, `packages/paperEngine`, MSW handlers, `apps/api`, `apps/realtime`   |
| `[INT]`  | Shared glue: contracts, tokens, utils, API client, config, wiring between layers, docs                   |
| `[TEST]` | Test harnesses, E2E, a11y, performance and budget checks                                                 |

**Definition of done (every task)**

- The "Done when" criteria are met and covered by an automated test wherever they can be.
- `npm run check` is green; new code has tests and changed packages stay at or above 80% coverage.
- Conventions from CLAUDE.md §6: TypeScript strict, no unexplained `any`, camelCase files and
  PascalCase component files, named exports only, money as integer paise, times stored in UTC and
  shown in IST, API and WS payloads typed from `packages/contracts`, UI strings in the feature's
  `strings.ts`.
- UI tasks: a Storybook story (for `packages/ui`) or a component test, axe clean, up/down never shown
  by colour alone (▲▼ plus text), and screenshots in the PR.
- Mock backend tasks: behaviour is the same in `msw` and `api` mode, checked by the dual-backend
  scenario suites (T-060 onward).
- No secrets, keys or real user data committed; new env vars go in `.env.example`.

## E1: Foundation + app shell

- [x] T-001 [INT] Write ADR 0004 "Mock backend and paper engine" covering isomorphic packages/marketData and new packages/paperEngine, in-memory repos in apps/api, apps/realtime with Redis pub/sub, and the VITE_API_MODE switch. Depends: none. Done when: docs/adr/0004-mock-backend-and-paper-engine.md has Status, Context, Decision and Consequences, and owner approval is recorded in the PR.
- [x] T-002 [INT] Scaffold packages/utils with the shared tsconfig, Vitest, a dist build and a named-export index. Depends: none. Done when: @nthstock/utils imports from both apps/web and apps/api and npm run check is green.
- [x] T-003 [INT] Add formatInr(paise), formatInrCompact(paise) for L and Cr, and parseRupeesToPaise(text), integer-only. Depends: T-002. Done when: tests cover 0, negatives, 10000050 → "₹1,00,000.50" and 1.2 Cr compact, and "12.345" is rejected.
- [x] T-004 [INT] Add formatPct and formatChange returning text, direction and a screen-reader label. Depends: T-002. Done when: formatChange(125) returns text "▲ 1.25%", direction "up" and srLabel "up 1.25 percent", and zero returns a flat marker.
- [x] T-005 [INT] Add IST helpers (formatIstTime, formatIstDate, istDateKey) and an injectable Clock with systemClock and fixedClock. Depends: T-002. Done when: tests pass under TZ=UTC and TZ=America/New_York.
- [x] T-006 [INT] Add the NSE market calendar with pre-open 9:00–9:15 and normal 9:15–15:30 IST, the 2026 holiday list as data, getMarketStatus(clock) and nextSessionOpen(clock). Depends: T-005. Done when: tests cover a weekend, a listed holiday, and 9:14, 9:15, 15:30 and 15:31 IST.
- [x] T-007 [TEST] Add Vitest v8 coverage with an 80% threshold per package and add coverage output to turbo.json. Depends: T-002. Done when: npm run test fails if packages/utils coverage drops below 80%.
- [ ] T-008 [INT] Scaffold packages/tokens with nthstock's own palette, typography, spacing, radius, shadow, z-index and motion, generating tokens.css variables. Depends: none. Done when: the build emits tokens.css and a test asserts text, up and down colours reach 4.5:1 contrast on the surface colour.
- [ ] T-009 [INT] Generate a Tailwind preset from the tokens and wire Tailwind into apps/web. Depends: T-008. Done when: bg-surface and text-up resolve to CSS variables and a lint or grep check fails on hard-coded hex colours in apps/web/src.
- [ ] T-010 [INT] Self-host subset fonts (OFL licence) with preload and font-display swap. Depends: T-009. Done when: the production build makes no external font requests and total woff2 size is under 100 KB.
- [ ] T-011 [FE] Scaffold packages/ui (React, Vitest, React Testing Library, class-variance-authority + tailwind-merge per ADR 0005) and Storybook loading tokens.css. Depends: T-008, T-009. Done when: Storybook starts locally and build-storybook runs in CI through Turborepo.
- [ ] T-012 [TEST] Add the Storybook a11y addon and test runner so axe runs on every story in CI. Depends: T-011. Done when: a deliberately low-contrast story fails CI and main passes.
- [ ] T-013 [FE] Add Button and IconButton with primary, buy, sell and ghost variants, sizes and a loading state. Depends: T-011. Done when: stories cover every variant and tests cover disabled and loading states.
- [ ] T-014 [FE] Add Field, Input, NumberInput (integer and price with tick step) and OtpInput (6 boxes with paste). Depends: T-011. Done when: pasting 123456 fills all six boxes and errors are announced via aria-describedby.
- [ ] T-015 [FE] Add Radix wrappers for Dialog, Sheet (right slide-over), Tabs, DropdownMenu, Tooltip and Toast. Depends: T-011. Done when: focus is trapped and returned on close and Esc closes Dialog and Sheet (tests).
- [ ] T-016 [FE] Add SegmentedControl (for Buy/Sell, Market/Limit, Delivery/Intraday) and Switch. Depends: T-011. Done when: arrow keys move the selection and roles are radiogroup and radio (tests).
- [ ] T-017 [FE] Add table primitives and a VirtualList on TanStack Virtual with sticky header and arrow-key row focus. Depends: T-011. Done when: a 5,000-row story keeps fewer than 40 rows in the DOM and ↑/↓ move row focus.
- [ ] T-018 [FE] Add ChangeBadge built on formatChange showing ▲▼, text and colour. Depends: T-011, T-004. Done when: the rendered output contains the arrow and the screen-reader label, not only a colour class.
- [ ] T-019 [FE] Add Skeleton, EmptyState and ErrorState with a retry action. Depends: T-011. Done when: stories exist and the retry button calls its handler (test).
- [ ] T-020 [FE] Add an SVG Sparkline with up/down colour and a text alternative. Depends: T-011. Done when: 100 points render as one path and a flat series renders without dividing by zero.
- [ ] T-021 [FE] Add the nthstock logo and an own SVG icon set as named exports. Depends: T-011. Done when: a Storybook gallery shows every icon and unused icons are absent from the web build.
- [ ] T-022 [FE] Add TanStack Router file-based routes (ADR 0005: routes/ folder, thin route files, `@/` alias, import-boundary lint rules) with /login, /dashboard, /stocks/$symbol, /orders, /positions, /portfolio, /funds and a 404, code-split per route. Depends: T-009. Done when: each route renders a placeholder and the build emits one chunk per route.
- [ ] T-023 [FE] Add app providers: TanStack Query defaults, Zustand store conventions and an error boundary per route. Depends: T-022, T-019. Done when: an error thrown inside a route renders ErrorState instead of a blank page (test).
- [ ] T-024 [FE] Build the app shell with header, left rail and main area, collapsing the rail to a drawer under 1024 px. Depends: T-022. Done when: there is no horizontal scroll at 360 px and a 1440 px screenshot matching the reference layout is in the PR.
- [ ] T-025 [FE] Build the header with logo, nav tabs (Dashboard, Portfolio, Positions, Orders, Funds), support, profile slot and More menu. Depends: T-024, T-021, T-015. Done when: the active tab has aria-current="page" and stories exist for signed-in and signed-out.
- [ ] T-026 [FE] Add an IndexTicker component in the header for Nifty 50 and BSE Sensex, driven by props (level, change) until live data is wired in E4. Depends: T-025, T-018. Done when: stories show up, down and flat states with ▲▼ and text.
- [ ] T-027 [FE] Build the left rail frame: search slot, sort slot, collapsible "My Watchlist" section with an empty state and Add Stock button, drawer on small screens. Depends: T-024, T-019. Done when: the collapsed state is remembered in localStorage inside try/catch and the rail still renders when storage throws.
- [ ] T-028 [FE] Add a global keyboard-shortcut hook useShortcut that ignores typing in inputs, plus a ? help dialog. Depends: T-022, T-015. Done when: / typed inside an input does not fire and ? opens the shortcut list (tests).
- [ ] T-029 [FE] Add a market-status pill in the header (Open, Pre-open, Closed, Holiday, next open in IST). Depends: T-025, T-006. Done when: fixed clocks for each state show the correct text (tests).
- [ ] T-030 [TEST] Set up Playwright (Chrome only) with an app-shell smoke test and a CI job. Depends: T-024. Done when: npm run e2e passes locally and in CI.

## E2: Contracts + mock server

- [x] T-031 [INT] Scaffold packages/contracts with Zod primitives: Paise (int), TradingSymbol, Exchange (NSE, BSE), IsoUtc, ApiError envelope and cursor pagination. Depends: none. Done when: the package builds and tests reject float paise and lowercase symbols.
- [x] T-032 [INT] Add market contracts: Instrument (with numeric token), InstrumentStats, Quote, Candle, CandleRange (1D, 1W, 1M, 1Y, 5Y), Depth (5 bids, 5 asks), IndexSummary, StockList and Movers. Depends: T-031. Done when: inferred types are exported and each schema has a fixture round-trip test.
- [x] T-033 [INT] Add auth contracts for OTP request and verify, PIN set and verify, Session, User and Device. Depends: T-031. Done when: schemas accept only 10-digit mobiles starting 6–9, 6-digit OTPs and 4–6 digit PINs (tests).
- [x] T-034 [INT] Add watchlist contracts for lists, items, create, rename, delete, add, remove and reorder, with exported limits of 10 lists and 50 items. Depends: T-031. Done when: a 51-item list fails validation in a test.
- [x] T-035 [INT] Add order contracts: side, type (MARKET, LIMIT), product (DELIVERY, INTRADAY), status (AMO, OPEN, EXECUTED, CANCELLED, REJECTED), and place, modify and cancel requests with refinements. Depends: T-031. Done when: tests show LIMIT without a price fails, qty must be an integer ≥ 1, and price must be a multiple of 5 paise.
- [x] T-036 [INT] Add portfolio and funds contracts: Position, Holding, PortfolioSummary, FundsSummary, LedgerEntry and the reset request. Depends: T-031. Done when: inferred types are exported and fixture tests pass.
- [x] T-037 [INT] Add WS message contracts: client subscribe, unsubscribe and ping; server quotes, orderUpdate, pong and error; a protocol version field. Depends: T-032, T-035. Done when: the discriminated union parses every fixture and rejects an unknown type.
- [x] T-038 [INT] Add the REST route map (method, path, request and response schema per endpoint) as the single source for MSW, Fastify and the API client. Depends: T-032, T-033, T-034, T-035, T-036. Done when: a type test fails if any route lacks a response schema.
- [x] T-039 [MOCK] Scaffold isomorphic packages/marketData with the MarketDataAdapter interface and a reusable adapter contract test suite. Depends: T-001, T-032. Done when: runAdapterContractTests(adapter) is exported and passes against a stub.
- [x] T-040 [MOCK] Add a seeded PRNG (mulberry32) used by all mock data. Depends: T-039. Done when: the same seed gives identical first 1,000 values (test).
- [x] T-041 [MOCK] Generate the symbol master: ~100 hand-listed large-cap NSE tickers plus faker-generated equities to ~5,000, with sector, market-cap bucket, base price and 5-paise tick, and indices (NIFTY 50, SENSEX, NIFTY BANK, NIFTY IT, NIFTY MIDCAP 100) with constituents. Depends: T-040. Done when: there are 4,950–5,050 unique symbols, generation takes under 200 ms, and every constituent exists in the master.
- [x] T-042 [MOCK] Add the GBM tick generator with per-sector drift and volatility, prices rounded to tick in paise, and a ±20% circuit band. Depends: T-041, T-006. Done when: a simulated day never breaches the band and every price is an integer multiple of 5 (tests).
- [x] T-043 [MOCK] Compute index levels from weighted constituent prices. Depends: T-042. Done when: the index change sign matches the weighted constituent change (test).
- [x] T-044 [MOCK] Generate candle history for 1D (1-min), 1W (5-min), 1M (30-min), 1Y (daily) and 5Y (weekly) ending at the current price and skipping weekends and holidays. Depends: T-042, T-006. Done when: the last close equals LTP, no candle falls on a holiday, and low ≤ open, close ≤ high for every candle.
- [x] T-045 [MOCK] Generate top-5 market depth around the LTP. Depends: T-042. Done when: bids descend, asks ascend, best bid < best ask and all prices are on tick (test).
- [x] T-046 [MOCK] Derive curated lists (Market Giants, Best Returns, Highest Dividends, Top IT) and movers (gainers and losers per index) from mock quotes. Depends: T-042, T-043. Done when: gainers sort descending by % change and each list has 10–20 items.
- [x] T-047 [MOCK] Build the in-memory search index ranking exact symbol, then symbol prefix, then name token. Depends: T-041. Done when: "inf" returns INFY first and a query over 5,000 symbols takes under 5 ms p95 (bench test).
- [x] T-048 [MOCK] Compose MockMarketDataAdapter, ticking only while the market is open, with a MOCK_MARKET_ALWAYS_OPEN / VITE_MOCK_MARKET_OPEN override for demos. Depends: T-042, T-043, T-044, T-045, T-046, T-047. Done when: it passes the adapter contract suite and emits no ticks on a holiday clock unless the override is set.
- [ ] T-049 [INT] Add the web runtime config module for VITE_API_MODE (msw, api) and the API and WS base URLs, documented in .env.example. Depends: T-022. Done when: an invalid mode fails fast at startup and .env.example lists every variable with no secret values.
- [ ] T-050 [MOCK] Set up MSW in apps/web/src/mocks with a browser worker in msw mode and a node server for Vitest. Depends: T-049. Done when: the dev console shows MSW enabled in msw mode and an api-mode production build contains no MSW code.
- [ ] T-051 [MOCK] Add a typed handler helper that builds MSW handlers from the route map, validates requests and responses with Zod, and adds configurable latency (default 50–150 ms). Depends: T-050, T-038. Done when: a handler returning an invalid body fails its test.
- [ ] T-052 [MOCK] Add MSW market handlers for instruments, search, batch quotes, candles, depth, stats, indices, lists and movers. Depends: T-051, T-048. Done when: every handler's response passes its schema in a test.
- [ ] T-053 [INT] Scaffold packages/apiClient with a typed REST client generated from the route map (Zod-parsed responses, typed ApiError, credentials, CSRF header). Depends: T-038. Done when: tests against the MSW node server return parsed data and map a 4xx to ApiError.
- [ ] T-054 [INT] Add the WS client with ref-counted subscribe and unsubscribe, backoff with jitter, resubscribe on reconnect and heartbeat. Depends: T-053, T-037. Done when: two subscribers to INFY send one subscribe and a reconnect resends all subscriptions (tests).
- [ ] T-055 [MOCK] Add the MSW WebSocket handler streaming quotes from the adapter, honouring subscribe and unsubscribe, conflated to 4 updates/sec/symbol. Depends: T-050, T-048, T-037. Done when: no frames arrive for a symbol after unsubscribe and there are at most 4 frames/sec/symbol (tests).
- [ ] T-056 [INT] Build the quote store outside React: Map of symbol to Quote, per-symbol listeners, one requestAnimationFrame flush, and useQuote(symbol) via useSyncExternalStore that auto-subscribes. Depends: T-054. Done when: 100 ticks in one frame cause one render of the subscribed cell and none elsewhere (test).
- [ ] T-057 [FE] Add LivePrice with a CSS-only up/down flash plus ▲▼. Depends: T-056, T-018. Done when: a story shows simulated ticks and a render-count test proves only the ticking cell re-renders.
- [ ] T-058 [MOCK] Register apps/api routes from the contracts route map with Zod validation and a /v1 error handler returning ApiError. Depends: T-038. Done when: an invalid body returns 400 with the ApiError shape (app.inject test).
- [ ] T-059 [MOCK] Add in-memory repos behind per-module repo.ts interfaces, clock injection and a seeded demo user. Depends: T-058, T-005. Done when: each module exposes a repo interface and tests reset state between cases.
- [ ] T-060 [TEST] Build the dual-backend scenario harness so one scenario file runs against the MSW node server and against Fastify app.inject. Depends: T-051, T-058. Done when: a sample health scenario passes against both backends in npm run test.
- [ ] T-061 [MOCK] Add the apps/api market module for indices, lists, movers and batch quotes over a boot-time MockMarketDataAdapter singleton. Depends: T-058, T-048. Done when: each route returns schema-valid data via app.inject.
- [ ] T-062 [MOCK] Add apps/api routes for search, instrument, candles, depth and stats. Depends: T-061. Done when: an empty search query and an invalid range each return 400, and valid calls return schema-valid data.
- [ ] T-063 [TEST] Write the market scenario suite covering every market route for both backends. Depends: T-060, T-052, T-062. Done when: the suite passes against MSW and apps/api.
- [ ] T-064 [MOCK] Scaffold isomorphic packages/paperEngine with an injected clock and price source. Depends: T-001, T-035, T-036. Done when: it builds and is importable from apps/web/src/mocks and apps/api.
- [ ] T-065 [MOCK] Add the pure fill matcher: MARKET fills fully at LTP, LIMIT BUY fills at the limit when LTP ≤ limit, LIMIT SELL when LTP ≥ limit. Depends: T-064. Done when: scripted price paths fill, and do not fill, exactly as expected (tests).
- [ ] T-066 [MOCK] Add the funds ledger in paise: ₹10,00,000 opening credit, block on place, release on cancel, settle on fill, append-only entries with balanceAfter. Depends: T-064. Done when: a randomised sequence test shows available cash never goes negative and the ledger sum always equals the balance.
- [ ] T-067 [MOCK] Add position and holding math: net qty, weighted average, realised and unrealised P&L, day's P&L. Depends: T-065, T-066. Done when: buy 10 @ ₹100 and 10 @ ₹110 gives avg ₹105, and selling 5 @ ₹120 gives realised P&L ₹75.00 (tests).
- [ ] T-068 [INT] Add infra/docker-compose.yml with Redis 7 and document how to start it. Depends: T-001. Done when: Redis starts locally and redis-cli ping returns PONG.
- [ ] T-069 [MOCK] Scaffold apps/realtime (Node 22, TypeScript, Vitest, /health) with the WebSocket library chosen in ADR 0004. Depends: T-001. Done when: the dev server accepts a WS connection on port 8081 and /health returns ok.
- [ ] T-070 [MOCK] Add the realtime subscription registry with per-connection and per-symbol sets and a 200-symbol cap. Depends: T-069, T-037. Done when: the 201st subscribe returns an error message and a disconnect clears both maps (test).
- [ ] T-071 [MOCK] Make apps/api publish adapter ticks to a Redis channel. Depends: T-068, T-061. Done when: an integration test receives ticks on the ticks channel.
- [ ] T-072 [MOCK] Make apps/realtime subscribe to Redis and fan out quotes to subscribed connections only. Depends: T-070, T-071. Done when: a client subscribed to INFY receives INFY and never TCS (test).
- [ ] T-073 [MOCK] Conflate realtime output to 4 updates/sec/symbol and batch symbols into one frame per flush. Depends: T-072. Done when: 50 ticks/sec in yields at most 4 frames/sec/symbol carrying the latest value (test).
- [ ] T-074 [INT] Add a compact binary quote-frame codec in packages/contracts keyed by instrument token, with JSON for control messages, used by apps/realtime and the WS client. Depends: T-037, T-054, T-073. Done when: a round-trip property test passes and a quote costs at most 24 bytes per symbol.
- [ ] T-075 [MOCK] Add realtime heartbeat, a 60 s idle timeout, and slow-consumer handling that drops quote frames above 1 MB buffered. Depends: T-072. Done when: tests cover idle close and quote dropping for a slow client.
- [ ] T-076 [INT] Wire api mode in the web app: Vite proxy for REST with same-origin cookies, WS to apps/realtime, and npm run dev:api starting Redis, api, realtime and web. Depends: T-049, T-074. Done when: with VITE_API_MODE=api live prices come from apps/realtime and no MSW worker is registered.
- [ ] T-077 [INT] On tab hide keep only the active watchlist subscribed; on focus or reconnect fetch a REST snapshot and resubscribe. Depends: T-076, T-056. Done when: a hidden visibilitychange sends unsubscribe frames and prices resync from the snapshot on focus (test).
- [ ] T-078 [TEST] Playwright smoke in msw mode: the app boots and a LivePrice on a test route changes within 2 s. Depends: T-030, T-052, T-055, T-057. Done when: the test passes in CI.

## E3: Auth

- [ ] T-079 [MOCK] Add OTP request and verify in apps/api: mock SMS provider logs the OTP, fixed dev OTP 123456 outside production, 30 s resend throttle, captchaRequired after 3 wrong attempts. Depends: T-059, T-033. Done when: a resend within 30 s returns 429 and the 3rd wrong OTP sets captchaRequired (tests).
- [ ] T-080 [MOCK] Add sessions: 15-min access JWT, rotating refresh token in an httpOnly SameSite=Strict cookie, refresh and logout routes, reuse detection. Depends: T-079. Done when: reusing a refresh token returns 401 and revokes the token family (test).
- [ ] T-081 [MOCK] Add PIN set and verify with Argon2id, a trusted-device cookie, lockout after 5 wrong attempts and unlock via OTP. Depends: T-080. Done when: the 5th wrong PIN locks the account and a verified OTP clears the lock (tests).
- [ ] T-082 [MOCK] Add CSRF checks on state-changing routes and per-IP rate limits on auth routes. Depends: T-080. Done when: a POST without the CSRF header returns 403 and the 21st OTP request in a minute from one IP returns 429.
- [ ] T-083 [MOCK] Authenticate the apps/realtime WS upgrade with the access JWT cookie. Depends: T-069, T-080. Done when: a missing or expired token closes with code 4401 (test).
- [ ] T-084 [MOCK] Add MSW auth handlers matching the apps/api rules (dev OTP, resend throttle, PIN lockout, simulated session cookie). Depends: T-051, T-033. Done when: every auth handler returns schema-valid responses.
- [ ] T-085 [TEST] Write the auth scenario suite for both backends. Depends: T-060, T-079, T-080, T-081, T-082, T-084. Done when: OTP, PIN, lockout, refresh and logout scenarios pass against MSW and apps/api.
- [ ] T-086 [FE] Build the mobile number screen with +91 prefix, validation and a DPDP consent checkbox. Depends: T-014, T-053, T-084. Done when: an invalid number shows an inline error and submit calls the OTP route.
- [ ] T-087 [FE] Build the OTP screen with 6-box input, auto-submit, resend countdown, change number and error states. Depends: T-086. Done when: resend stays disabled until the countdown ends (fake-timer test) and a wrong OTP shows the error.
- [ ] T-088 [FE] Build PIN setup for first login and PIN entry for trusted devices, with a lockout state and "Unlock with OTP". Depends: T-087. Done when: a trusted device goes straight to PIN entry and 5 wrong PINs show the lockout state.
- [ ] T-089 [FE] Add the session store, one silent refresh on 401, and a route guard with a redirect param. Depends: T-053, T-088. Done when: an expired access token refreshes transparently and unauthenticated /orders goes to /login?redirect=/orders (tests).
- [ ] T-090 [FE] Build the profile menu with name, masked mobile, mocked KYC badge and logout. Depends: T-089, T-025. Done when: logout clears the Query cache and lands on /login.
- [ ] T-091 [TEST] Playwright login journey: mobile, OTP, set PIN, dashboard, then reload and log in with PIN. Depends: T-030, T-089. Done when: the test passes in msw mode in CI.

## E4: Dashboard

- [ ] T-092 [FE] Wire the header IndexTicker for Nifty 50 and Sensex to useQuote. Depends: T-026, T-057. Done when: a tick updates the ticker without re-rendering the rest of the header (render-count test).
- [ ] T-093 [FE] Build the dashboard grid and greeting hero with an IST-based greeting and onboarding CTA. Depends: T-024, T-089. Done when: 08:00, 13:00 and 19:00 IST show the morning, afternoon and evening greetings.
- [ ] T-094 [FE] Add a lazy-loaded Lightweight Charts wrapper PriceChart with a token-based theme, resize observer and disposal on unmount. Depends: T-022, T-008. Done when: the charts library is absent from the initial chunk in the build output.
- [ ] T-095 [FE] Build the Nifty 50 chart card with area series, range tabs and a LIVE badge while the market is open. Depends: T-094, T-052, T-029. Done when: the LIVE badge is hidden on a holiday clock and switching range refetches.
- [ ] T-096 [FE] Build the Market Indices cards with sparklines, horizontal scroll snap and keyboard scrolling. Depends: T-020, T-052, T-057. Done when: at least 5 cards render with live values and ▲▼ change.
- [ ] T-097 [FE] Build the Stocks Lists section with a tab per curated list and rows that tick live and open stock detail. Depends: T-017, T-052, T-057. Done when: switching tabs fetches that list and clicking a row navigates to /stocks/<symbol>.
- [ ] T-098 [FE] Build Market Movers with a gainers/losers toggle and an index selector. Depends: T-017, T-052. Done when: changing the index refetches and losers show ▼ with negative text.
- [ ] T-099 [FE] Add per-section skeletons and error isolation on the dashboard. Depends: T-093, T-095, T-096, T-097, T-098. Done when: a 500 from movers shows ErrorState only in the movers card (test).
- [ ] T-100 [TEST] Add dashboard component tests on MSW and a Playwright screenshot at 1440 px. Depends: T-099. Done when: tests pass in CI and the screenshot is attached to the PR.
- [ ] T-101 [TEST] Measure dashboard CLS during load in Playwright. Depends: T-100. Done when: CLS is under 0.05.

## E5: Search + stock detail

- [ ] T-102 [MOCK] Add a popular-searches route (top symbols by volume) in apps/api and MSW. Depends: T-052, T-062. Done when: both backends return the same schema-valid list in the scenario suite.
- [ ] T-103 [FE] Build header search: / focuses it, 150 ms debounce, results dropdown with highlighted matches. Depends: T-025, T-028, T-052. Done when: / focuses the box and results show symbol, name and exchange.
- [ ] T-104 [FE] Add search keyboard navigation (↑/↓, Enter, Esc), recent searches, and popular searches when the box is empty. Depends: T-103, T-102. Done when: Enter opens /stocks/<symbol>, Esc closes and returns focus, and an empty box shows recent then popular.
- [ ] T-105 [FE] Add the stock detail route loader (instrument and quote) with a not-found state and document title. Depends: T-022, T-052. Done when: /stocks/NOPE shows not-found and /stocks/INFY sets the page title.
- [ ] T-106 [FE] Build the detail header (name, symbol, NSE/BSE toggle, large LivePrice, day change) with Buy and Sell buttons that dispatch openTicket to a new ticketIntent store. Depends: T-105, T-057, T-013. Done when: clicking Buy sets ticketIntent to the symbol with side BUY (store test).
- [ ] T-107 [FE] Build the price chart with 1D, 1W, 1M, 1Y and 5Y tabs (range in the URL), an area/candle toggle and a crosshair tooltip in IST and ₹. Depends: T-094, T-105. Done when: changing range updates the URL and refetches, and the tooltip shows en-IN grouped rupees.
- [ ] T-108 [FE] Update the 1D chart live from the quote store in 1-minute buckets. Depends: T-107, T-056. Done when: a tick in the same minute updates the last bar and the next minute appends a bar (test).
- [ ] T-109 [FE] Build fundamentals and key stats: open, high, low, previous close, volume, 52-week range, market cap, P/E, dividend yield and a day-range bar. Depends: T-105. Done when: market cap renders in Cr via formatInrCompact and values come from InstrumentStats.
- [ ] T-110 [FE] Build the market depth table (top 5) with quantity bars and totals, refreshed every 1 s while visible and the market is open. Depends: T-105, T-017. Done when: bars scale to quantity and polling stops when the tab is hidden (test).
- [ ] T-111 [FE] Build the overview section with about text, sector, index membership chips and Read more. Depends: T-105. Done when: long text collapses and expands with a button that has an accessible name.
- [ ] T-112 [FE] Make stock detail responsive: chart and stats left, depth right, stacked under 1024 px. Depends: T-106, T-107, T-108, T-109, T-110, T-111. Done when: screenshots at 1440 and 768 px are in the PR and there is no horizontal scroll at 360 px.
- [ ] T-113 [TEST] Test the chart wrapper for lazy load, empty candles and disposal on unmount. Depends: T-094. Done when: unmount leaves no active chart or ResizeObserver (test).
- [ ] T-114 [TEST] Playwright: search, open stock detail, switch all five ranges, see depth. Depends: T-091, T-104, T-112. Done when: the test passes in msw mode in CI.

## E6: Watchlists

- [ ] T-115 [MOCK] Add the apps/api watchlist module: CRUD, add and remove, reorder items and lists, limits, and a default "My Watchlist" on first login. Depends: T-059, T-034. Done when: the 51st item returns 409 with a plain-language message and reorder persists.
- [ ] T-116 [MOCK] Add MSW watchlist handlers with the same rules, keeping state in sessionStorage inside try/catch. Depends: T-051, T-034. Done when: handlers return schema-valid responses and state survives a page reload.
- [ ] T-117 [TEST] Write the watchlist scenario suite for both backends. Depends: T-060, T-115, T-116. Done when: the suite passes against MSW and apps/api.
- [ ] T-118 [FE] Add watchlist Query hooks with optimistic updates and rollback. Depends: T-053, T-116. Done when: a failed add rolls back and shows a toast (test).
- [ ] T-119 [FE] Fill the left rail with watchlist tabs for named lists and virtualised rows (symbol, exchange, LivePrice, change). Depends: T-118, T-017, T-057, T-027. Done when: a new user sees the empty state and rows tick live for a seeded list.
- [ ] T-120 [FE] Add create, rename and delete watchlist dialogs (name 1–24 characters, unique). Depends: T-119, T-015. Done when: a duplicate name shows an error and delete asks for confirmation.
- [ ] T-121 [FE] Add stocks from search results and the stock detail star, and remove them from row actions. Depends: T-119, T-103, T-106. Done when: an added symbol appears immediately and survives reload, and the star reflects membership.
- [ ] T-122 [FE] Add reorder for items and lists with a drag handle (native pointer events, no new dependency) and Alt+↑/↓ with live-region announcements. Depends: T-119. Done when: keyboard reorder works in a test and the order persists after reload.
- [ ] T-123 [FE] Add the sort menu (name, LTP, % change, custom) with re-sort throttled to every 2 s so rows do not jump on each tick. Depends: T-119. Done when: % change descending sorts correctly and custom restores the saved order.
- [ ] T-124 [FE] Subscribe only mounted watchlist rows to live quotes. Depends: T-119, T-056. Done when: scrolling a row out of view sends unsubscribe for its symbol (test).
- [ ] T-125 [FE] Add hover B/S buttons on rows and B/S keys on a focused row, dispatching openTicket to the ticketIntent store. Depends: T-119, T-106, T-028. Done when: pressing B on a focused INFY row sets ticketIntent to INFY BUY and B typed in an input does nothing (tests).
- [ ] T-126 [TEST] Playwright: create a list, search INFY, add it, reorder, sort, remove. Depends: T-091, T-121, T-122, T-123. Done when: the test passes in msw mode in CI.

## E7: Order ticket + paper orders

- [ ] T-127 [MOCK] Add order validation in paperEngine: integer qty, 5-paise tick, within the circuit band, enough cash for BUY, enough holdings for a delivery SELL, intraday only in market hours. Depends: T-064, T-006. Done when: each rule has a test with a plain-language rejection reason.
- [ ] T-128 [MOCK] Add the order state machine (AMO to OPEN to EXECUTED or CANCELLED, REJECTED on validation, modify only in AMO or OPEN) using the fill matcher. Depends: T-064, T-065. Done when: table-driven tests reject every illegal transition.
- [ ] T-129 [MOCK] Add AMO: orders placed outside market hours are stored as AMO and released at the next session's 9:15 IST. Depends: T-128, T-006. Done when: an order at 20:00 IST is AMO and advancing the clock to 9:15 on the next trading day executes or opens it.
- [ ] T-130 [MOCK] Add end-of-day processing: square off intraday at 15:20 IST, cancel open day orders at 15:30, move delivery positions to holdings. Depends: T-067, T-128, T-006. Done when: a fixed-clock EOD run produces the expected orders, positions and holdings.
- [ ] T-131 [MOCK] Add the apps/api orders module (place, modify, cancel, list by status, get) with the engine fed by adapter ticks, a funds summary route, and an in-memory append-only audit log. Depends: T-059, T-061, T-067, T-127, T-128, T-129, T-130. Done when: a MARKET order returns EXECUTED at LTP within 300 ms and every order action writes an audit entry.
- [ ] T-132 [MOCK] Add MSW order and funds-summary handlers using paperEngine fed by in-browser ticks, with state in sessionStorage and orderUpdate sent on the MSW WebSocket. Depends: T-051, T-055, T-067, T-127, T-128, T-129, T-130. Done when: a limit order fills in the browser when the mock price crosses and an orderUpdate frame is received.
- [ ] T-133 [MOCK] Publish per-user order updates from apps/api to Redis and deliver them on the apps/realtime private channel. Depends: T-072, T-083, T-131. Done when: user A receives their fill and never user B's (test).
- [ ] T-134 [TEST] Write the order scenario suite (market, limit crossing, modify, cancel, insufficient funds, AMO) for both backends. Depends: T-060, T-131, T-132. Done when: the suite passes against MSW and apps/api.
- [ ] T-135 [FE] Build the order ticket slide-over that opens from the ticketIntent store, keeps chart and watchlist visible, closes on Esc and returns focus. Depends: T-015, T-028, T-106. Done when: Buy on stock detail opens it and Esc closes it with focus back on the Buy button.
- [ ] T-136 [FE] Build the ticket form (React Hook Form with contract Zod schemas): side, Market/Limit, Delivery/Intraday, qty stepper, price prefilled with LTP and disabled for market, live LTP, required amount and available cash. Depends: T-135, T-016, T-014, T-035, T-132. Done when: a price off the 5-paise tick and qty 0 each show an inline error.
- [ ] T-137 [FE] Add the depth mini-panel inside the ticket where clicking a price fills the limit price. Depends: T-136, T-110. Done when: clicking a bid sets the price field and switches the type to Limit.
- [ ] T-138 [FE] Add AMO handling: the banner "Market is closed. Your order will be placed as AMO at 9:15 AM on <date>." and a Place AMO button. Depends: T-136, T-029. Done when: a closed-market clock shows the banner and the button label.
- [ ] T-139 [FE] Add the confirmation step and results: review summary, Confirm, success toast linking to the order book, and inline rejection reasons. Depends: T-136. Done when: a rejected order keeps the form values and success closes the ticket and invalidates orders and funds queries.
- [ ] T-140 [TEST] Test the ticket: validation matrix, AMO, confirm flow on MSW and axe while open. Depends: T-137, T-138, T-139. Done when: tests pass and ticket feature coverage is at least 80%.

## E8: Order book, positions, holdings, portfolio summary

- [ ] T-141 [MOCK] Add apps/api positions, holdings and portfolio summary routes. Depends: T-131. Done when: routes return schema-valid data derived from paperEngine state.
- [ ] T-142 [MOCK] Add MSW positions, holdings and portfolio summary handlers. Depends: T-132. Done when: handlers return schema-valid data from the same paperEngine state as the order handlers.
- [ ] T-143 [TEST] Write the portfolio scenario suite for both backends. Depends: T-060, T-141, T-142. Done when: the suite passes against MSW and apps/api.
- [ ] T-144 [FE] Build the order book with Open, Executed and Cancelled (including Rejected) tabs and counts, showing IST time, symbol, side, type, product, filled/total qty, price and status. Depends: T-017, T-132. Done when: each tab shows only its statuses and its count matches.
- [ ] T-145 [FE] Add modify (ticket in modify mode, qty and price only) and cancel (confirm dialog) on open orders. Depends: T-144, T-136. Done when: a modified price shows in the list and a cancelled order moves to the Cancelled tab.
- [ ] T-146 [FE] Add an order detail drawer with a status timeline and rejection reason. Depends: T-144, T-015. Done when: every transition shows with an IST timestamp.
- [ ] T-147 [FE] Handle orderUpdate messages by invalidating orders, positions and funds and toasting fills such as "Order executed: BUY 10 INFY @ ₹1,512.35". Depends: T-144, T-054, T-132. Done when: a limit fill moves the row to Executed without a reload (test).
- [ ] T-148 [INT] Add live P&L selectors that combine paperEngine P&L math with the quote store. Depends: T-067, T-056. Done when: a tick changes only the P&L of positions in that symbol (test).
- [ ] T-149 [FE] Build positions with a pinned live total P&L bar (realised plus unrealised, ▲▼) and rows for qty, avg, live LTP and P&L. Depends: T-142, T-148. Done when: P&L recomputes on each tick and only P&L cells re-render (render-count test).
- [ ] T-150 [FE] Add Exit on a position, opening the ticket for the opposite side with the same qty and product. Depends: T-149, T-135. Done when: Exit on a long 10 INFY intraday position opens SELL 10 INTRADAY.
- [ ] T-151 [FE] Build the holdings table (qty, avg price, LTP, current value, P&L, P&L %) with column sort. Depends: T-142, T-148. Done when: current value equals qty × LTP in paise and sorting by P&L works.
- [ ] T-152 [FE] Build the live portfolio summary (invested, current value, total P&L, day's P&L) at the top of Portfolio. Depends: T-151. Done when: the totals equal the sum of the holdings rows after each tick (test).
- [ ] T-153 [FE] Add empty states for orders, positions and holdings with a CTA to search or the watchlist. Depends: T-144, T-149, T-151. Done when: each empty state has a story or component test.
- [ ] T-154 [TEST] Add component tests on MSW for order book, positions, holdings and portfolio summary. Depends: T-145, T-146, T-147, T-149, T-150, T-152, T-153. Done when: tests pass and coverage for these features is at least 80%.

## E9: Funds

- [ ] T-155 [MOCK] Add apps/api ledger (paginated) and reset routes; reset cancels open orders, clears positions and holdings, and restores ₹10,00,000. Depends: T-131. Done when: reset restores ₹10,00,000.00 and writes a RESET ledger entry.
- [ ] T-156 [MOCK] Add MSW ledger and reset handlers with the same rules. Depends: T-132. Done when: handlers return schema-valid data and reset clears the in-browser engine state.
- [ ] T-157 [TEST] Write the funds scenario suite for both backends. Depends: T-060, T-155, T-156. Done when: the suite passes against MSW and apps/api.
- [ ] T-158 [FE] Build the funds summary: available cash, blocked, invested, total and the ₹10,00,000 opening balance. Depends: T-156. Done when: after a ₹15,000 buy, available drops by ₹15,000.00 and total is unchanged before price moves (test).
- [ ] T-159 [FE] Build the virtualised ledger with type, signed amount, balance after, IST time and paging. Depends: T-158, T-017. Done when: scrolling to the end loads the next ledger page.
- [ ] T-160 [FE] Add reset paper balance: a danger dialog that explains what is cleared and requires typing RESET. Depends: T-158, T-015. Done when: after reset funds show ₹10,00,000.00 and orders, positions and holdings are empty.
- [ ] T-161 [TEST] Add funds component tests on MSW and a Playwright reset journey. Depends: T-091, T-159, T-160. Done when: tests pass in CI and funds feature coverage is at least 80%.

## E10: E2E + quality

- [ ] T-162 [MOCK] Add test-only controls in both backends: clock override and scripted price per symbol (/v1/__test routes only when NODE_ENV=test, plus MSW equivalents). Depends: T-131, T-132. Done when: the routes return 404 in a production build (test).
- [ ] T-163 [TEST] Playwright golden path in msw mode: log in, add INFY to a watchlist, open stock detail, buy 10 market delivery, see Executed in the order book, see INFY in positions and holdings, see funds debited. Depends: T-091, T-114, T-126, T-140, T-154, T-161. Done when: the test passes in CI.
- [ ] T-164 [TEST] Run the golden path in api mode in CI with a Redis service, apps/api, apps/realtime and the web app. Depends: T-163, T-076, T-133. Done when: the CI job passes.
- [ ] T-165 [TEST] E2E for a limit order filled by a scripted price cross and an AMO released at 9:15. Depends: T-163, T-162. Done when: both scenarios pass in msw and api mode.
- [ ] T-166 [TEST] Run axe on every route while logged in and on the open order ticket. Depends: T-163. Done when: there are zero serious or critical violations.
- [ ] T-167 [TEST] Keyboard-only E2E: / to search, Enter, B, fill the ticket, confirm, Esc, with visible focus throughout. Depends: T-163, T-125. Done when: an order is placed without using the mouse.
- [ ] T-168 [TEST] Add a bundle budget check: initial JS under 200 KB gzipped and charts in a lazy chunk. Depends: T-100, T-114. Done when: CI fails when the budget is exceeded.
- [ ] T-169 [TEST] Add Lighthouse CI budgets for the dashboard and stock detail (LCP under 2.0 s, CLS under 0.05, TBT as the INP proxy). Depends: T-168. Done when: the CI job enforces the budgets.
- [ ] T-170 [TEST] Render-performance test with 200 ticking symbols in the watchlist for 10 s. Depends: T-124. Done when: the Playwright trace shows no main-thread task over 50 ms.
- [ ] T-171 [TEST] Integration test with Testcontainers Redis measuring tick-to-screen from apps/api through apps/realtime to the browser. Depends: T-076. Done when: tick-to-screen p95 is under 500 ms locally.
- [ ] T-172 [TEST] Add a k6 smoke script in infra/k6 (1,000 sockets, local only, not in CI). Depends: T-075. Done when: the script runs and reports frames/sec and p95 delivery latency.
- [ ] T-173 [INT] Add security headers (CSP, X-Frame-Options DENY, HSTS outside local, cookie flags) to apps/api and the web preview server. Depends: T-082, T-076. Done when: a test asserts the headers on /v1/health and on the preview server.
- [ ] T-174 [INT] Add a demo seed (user, two watchlists, some holdings and ledger history) and docs/runbooks/local-demo.md for both modes. Depends: T-164. Done when: npm run seed:demo in api mode and ?demo=1 in msw mode give the same starting state.
- [ ] T-175 [INT] Prepare the phase demo: recorded golden-path video, screenshots of every screen, and an owner sign-off checklist on the phase issue. Depends: T-164, T-165, T-166, T-167, T-169, T-170, T-171, T-173, T-174. Done when: the issue has all artifacts attached and is labelled for owner review.

## Summary

| Epic                                                  |   Tasks |     FE |   MOCK |    INT |   TEST |
|-------------------------------------------------------|--------:|-------:|-------:|-------:|-------:|
| E1 Foundation + app shell                             |      30 |     18 |      0 |      9 |      3 |
| E2 Contracts + mock server                            |      48 |      1 |     28 |     16 |      3 |
| E3 Auth                                               |      13 |      5 |      6 |      0 |      2 |
| E4 Dashboard                                          |      10 |      8 |      0 |      0 |      2 |
| E5 Search + stock detail                              |      13 |     10 |      1 |      0 |      2 |
| E6 Watchlists                                         |      12 |      8 |      2 |      0 |      2 |
| E7 Order ticket + paper orders                        |      14 |      5 |      7 |      0 |      2 |
| E8 Order book, positions, holdings, portfolio summary |      14 |      9 |      2 |      1 |      2 |
| E9 Funds                                              |       7 |      3 |      2 |      0 |      2 |
| E10 E2E + quality                                     |      14 |      0 |      1 |      3 |     10 |
| **Total**                                             | **175** | **67** | **49** | **29** | **30** |

## Out of scope for this list

- Real-money order routing, broker integration and any real exchange data feed.
- Real KYC, PAN, bank accounts and demat opening (KYC status stays mocked).
- F&O, options chain, mutual funds, IPO and NCD.
- Dark mode and languages other than English.
- The native mobile app (React Native + Expo).
- Postgres/Drizzle persistence, TOTP 2FA, the active-sessions screen and BullMQ jobs: the mock
  backend uses in-memory repos behind interfaces, and these follow in the Phase 3 backend list.
- Cloud deployment, autoscaling and full-scale load tests (Phase 6).
