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
│   │       ├── modules/<module>/ # routes.ts, service.ts, repo.ts (interface + memory),
│   │       │                     # pgRepo.ts (Postgres), schema.ts, tests beside them
│   │       ├── ticks/            # mock tick pump and quote publisher
│   │       └── test/             # injected backend, test Postgres/Redis, cross-module suites
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
├── tools/research/               # reference capture scripts, run locally by the owner
├── docs/                         # see docs/README.md
├── .claude/                      # see "Claude Code setup" in CLAUDE.md
└── .github/                      # workflows, PR template, CODEOWNERS, Dependabot
```
