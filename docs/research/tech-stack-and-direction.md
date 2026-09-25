# Document 2: Tech Stack and Product Direction

> Status: draft for owner review, 2026-09-25. Inputs: CLAUDE.md §0 and §4 (decisions D1–D11),
> `docs/requirements-qa.md` (all 7 rounds), the owner's Paytm Money screenshot, and Document 1
> (`paytm-money-equity.md`, the Paytm Money capture). The broker comparison in §4 is based on public,
> general knowledge of each product and was not re-verified against their live apps.
> Items marked **Open** still need an owner decision. Everything else was already agreed in the Q&A rounds.

## 1. Summary of decisions

| Area | Decision | Why |
|---|---|---|
| Frontend framework | **React 19 + TypeScript (strict), Vite SPA** | A trading terminal sits behind a login and is fully client-side, so SSR (Next.js) adds servers and hydration cost without an SEO benefit. React has the deepest ecosystem for grids, charts and virtualised lists, and React Native reuses it for the later mobile app (D10). |
| Routing | TanStack Router | Type-safe routes and search params (symbol, chart range, tab) and built-in loaders. |
| Server state | TanStack Query | Caching, retries and background refetch for REST (portfolio, orders, funds). |
| UI state | Zustand | Small, selector-based, and no provider re-render cascades. |
| Live prices | Dedicated quote store outside React, one subscription per symbol cell, flushed once per animation frame | A single price tick re-renders one cell, not the page. This is what keeps INP under 150 ms with hundreds of ticking symbols. |
| Real-time transport | WebSocket (`apps/realtime`) with binary frames, per-symbol subscribe/unsubscribe, conflated to 4 updates/sec/symbol | Same model the large Indian brokers use: server push, send only visible symbols, throttle. |
| Charts | TradingView Lightweight Charts (lazy-loaded), SVG sparklines | Canvas rendering, small (~45 KB), built for finance, Apache-2.0. The full TradingView "Advanced Charts" library needs a licence, so it is deferred. |
| Styling | Own design tokens → CSS variables → Tailwind preset, Radix UI primitives | Own look (D8), accessible primitives, and tokens shared with mobile. |
| Lists and grids | TanStack Virtual | Watchlists and order books stay smooth at 1,000+ rows. |
| Forms | React Hook Form + Zod (schemas from `packages/contracts`) | The order ticket validates against the same schema the API uses. |
| Testing | Vitest, React Testing Library, Playwright (Chrome), Storybook + axe | Unit, component and E2E, with a11y checks in CI. |
| Mock backend | **MSW in the browser for UI work**, plus the real Fastify `apps/api` with a mock market-data adapter (faker + GBM ticks) | MSW unblocks every screen immediately. The Fastify mock turns into the real backend without rewrites. See §5. |
| Backend | Node 22 + Fastify modular monolith, separate WebSocket server, Postgres 16, Redis 7 | Unchanged from D5 and D6. |

### Why not the alternatives

| Option | Verdict |
|---|---|
| Next.js | Good for public, SEO-driven pages (stock landing pages could use it later). The logged-in terminal gains nothing from SSR and pays for it in server cost at the 9:15 AM peak. |
| Vue / Nuxt | Capable, but a smaller ecosystem for trading grids and charts and no shared path to React Native. The owner's team is React-first. |
| Angular | Heavier bundle (misses the 200 KB initial-JS budget more easily) and slower iteration for a small team. |
| Svelte / SvelteKit | Excellent raw performance, but a smaller hiring pool and component ecosystem, and no mobile reuse. Our live-price store gives React comparable per-cell update cost. |
| Redux Toolkit | Works, but Query + Zustand covers the same ground with less code. |
| Polling for prices | Rejected: at 10 lakh users polling every second means 10 lakh requests/sec. A WebSocket push costs one frame per change per subscriber. |

## 2. Real-time architecture (frontend view)

```
WS frame (binary, batched) ─► wsClient (packages/apiClient)
   └─► quoteStore: Map<symbol, Quote>, plus a per-symbol listener set
         └─► requestAnimationFrame flush ─► only the subscribed <PriceCell symbol="INFY"> re-renders
Visible rows (TanStack Virtual) ─► subscribe on mount, unsubscribe on unmount ─► server sends only those symbols
```

- Colour flashes on up/down ticks always pair with ▲/▼ and text (WCAG, CLAUDE.md §6).
- When the tab is hidden, the client unsubscribes all but the watchlist and resyncs on focus.
- Reconnects use exponential backoff with jitter, then a REST snapshot to close the gap, then resubscribe.

## 3. UI direction

**Recommendation: keep Paytm Money's layout and information architecture (already decided, D8), and improve on it where the other brokers do better.** Copying the visual design is not allowed, and D8 gives nthstock its own palette, type and logo.

What we keep from the reference:
- Top bar with index tickers and the main tabs, a left-rail watchlist, and a dashboard of cards (index chart, indices, curated lists, movers).

What we change (borrowed from the brokers in §4):
1. **Order ticket as a slide-over panel**, not a separate page, so the chart and watchlist stay visible (Kite).
2. **Keyboard-first trading:** `/` for search, `B`/`S` for buy/sell on the focused row, `Esc` to close (Kite).
3. **Market depth (top 5 bid/ask)** inside the order ticket (Kite, Upstox).
4. **Positions with a live total P&L bar** pinned at the top (Dhan, Upstox).
5. **Plain-language order confirmations and error messages**, e.g. "Market is closed. Your order will be placed as AMO at 9:15 AM" (Groww).
6. **Clean, card-based discovery** for curated lists and movers (Groww).
7. **Multiple named watchlists as tabs** with drag-to-reorder (Kite, Angel One).

**Open:** do we want a "Pro" mode toggle (denser terminal layout, like Dhan and Upstox Pro) in v1, or later? Recommended: later.

## 4. How other Indian brokers do it

| Broker | Known for | Borrow | Avoid |
|---|---|---|---|
| **Zerodha Kite** | Fast, minimal terminal, keyboard shortcuts, multiple watchlists, market depth, TradingView and ChartIQ charts | Keyboard trading, watchlist tabs, slide-over order window, depth in the ticket | Dense UI can intimidate first-time investors |
| **Groww** | Very simple onboarding and discovery, clean cards, plain language | Discovery cards, plain-language copy, empty states | Fewer pro tools and shallow order options |
| **Upstox** | Pro web terminal, customisable layouts, option chain | Customisable dashboard widgets (later), P&L summary | Layout customisation adds complexity; not v1 |
| **Angel One** | Large retail base, research/advisory, SmartAPI | Research tags on stock pages (later), named watchlists | Promotional clutter on the dashboard |
| **Dhan** | Trader-first features, TradingView-native charting, fast order entry from charts | Order entry from the chart, positions P&L bar | Feature density |
| **Paytm Money** (reference) | Clean light dashboard, curated lists, movers | Overall layout and IA (D8) | Promo banners competing with market data (we shed them first under load anyway) |

## 5. Mock backend strategy

1. **MSW handlers** (`apps/web/src/mocks`), typed from `packages/contracts`, return seeded faker data and a simulated tick stream. The UI builds end to end with no server running.
2. **Fastify `apps/api` + `apps/realtime`** implement the same contracts over the mock market-data adapter (GBM random walk per symbol, NSE hours and holidays). A paper-trading engine fills market orders at the last price and limit orders when the price crosses.
3. Switching is a single env flag (`VITE_API_MODE=msw|api`), so the Phase 5 demo runs against the real mock server.

API shapes follow **our own contracts**. Document 1's capture informs which fields a screen needs, but we don't copy Paytm Money's endpoints or payloads (D3).

## 6. Architecture

Unchanged from CLAUDE.md §4: Vite SPA → CDN/WAF → load balancer → stateless Fastify API and a separately scaled WebSocket tier, with Postgres (primary + replicas) and Redis. The mock market-data adapter sits behind an interface so that a licensed vendor can plug in later.

## 7. Open questions for the owner

| # | Question | Recommended |
|---|---|---|
| O-1 | "Pro" dense layout toggle in v1? | Later |
| O-2 | Keyboard shortcuts in v1? | Yes (cheap, high value) |
| O-3 | Market depth (top 5) in the order ticket in v1? | Yes, simulated |
| O-4 | Options, F&O, IPO, MF pages? | Out of scope (CLAUDE.md §2) |
