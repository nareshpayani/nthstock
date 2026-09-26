# nthstock

An Indian stock market platform (paper trading) built from scratch with React, TypeScript and Node.js.

Start with [CLAUDE.md](./CLAUDE.md) for scope, architecture and conventions, and
[docs/requirements-qa.md](./docs/requirements-qa.md) for every requirement decision.

## Getting started

Requires Node 22 (`nvm use`).

```bash
npm install
npm run dev        # web on http://localhost:5173, API on http://localhost:4000
npm run check      # format, lint, typecheck, test, build
npm run storybook  # design system on http://localhost:6006
npm run e2e        # Playwright smoke tests (Chrome), msw mode with the mock market forced open
npm run infra:up   # Redis 7 in Docker Compose on 127.0.0.1:6379 (see infra/README.md)
```

The web app runs in **msw mode** by default: MSW mocks REST and the live-price WebSocket in the
browser over the mock market (`packages/marketData`). Prices tick only during NSE hours; for a demo
at any hour, force the mock market open:

```bash
VITE_MOCK_MARKET_OPEN=true npm run dev -w @nthstock/web
```

**api mode** runs the real backend: `npm run dev:api` starts Redis (Docker Compose), `apps/api`,
`apps/realtime` and the web app with `VITE_API_MODE=api`. The Vite dev server proxies `/v1` to
apps/api (port 4000) and `/ws` to apps/realtime (port 8081), so REST, cookies and the WebSocket
are all same-origin; no MSW worker is registered. Outside NSE hours, force the mock market open:

```bash
MOCK_MARKET_ALWAYS_OPEN=true npm run dev:api
```

All web variables are listed in [`apps/web/.env.example`](./apps/web/.env.example)
(`VITE_API_MODE=msw|api`, API and WS base URLs, the market-open override). A test page with live
prices is at `/dev/prices`.

| Workspace            | What it is                                                                  |
| -------------------- | --------------------------------------------------------------------------- |
| `apps/web`           | Vite + React SPA                                                            |
| `apps/api`           | Fastify API (`GET /v1/health`)                                              |
| `apps/realtime`      | Live-price WebSocket server on `ws` (`/ws`, `GET /health`, port 8081)       |
| `packages/config`    | Shared ESLint and TypeScript config                                         |
| `packages/ui`        | Design system components (Radix, cva, Tailwind) and Storybook               |
| `packages/apiClient` | Typed REST client, live-quote WebSocket client and quote store              |
| `packages/tokens`    | Design tokens → `tokens.css`, Tailwind v4 theme, self-hosted IBM Plex fonts |
