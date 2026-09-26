# CLAUDE.md — nthstock

> Status: **v0.3** (2026-09-25). All requirement questions settled; full Q&A log in `docs/requirements-qa.md`.
> Owner: Naresh Payani (@nareshpayani). Every agent working on this project reads this file first.
> Phase 1 (Foundation and design system) in progress.

## 0. Decisions (confirmed by owner, 2026-09-25)
| # | Topic | Decision |
|---|---|---|
| D1 | Product name | **nthstock** |
| D2 | Trading | **Paper trading only** for v1. No real-money order routing. |
| D3 | Market data | **Mock feed**: seeded NSE/BSE symbol master (~5,000 equities + major indices) and a random-walk (GBM) tick generator; `@faker-js/faker` for company/user data. Adapter interface so a licensed vendor or broker API can plug in later. No scraped/unofficial APIs. |
| D4 | Frontend | **Vite + React + TypeScript SPA**. Chrome only (latest 2). Fully responsive, desktop primary. **Single light theme, no dark mode.** English only, no i18n library in v1. |
| D5 | Backend | **Modular monolith** on Node.js 22 + Fastify (`apps/api`), plus a **separate realtime WebSocket server** (`apps/realtime`) that scales independently. |
| D6 | Database | **PostgreSQL 16** (+ TimescaleDB for candles from Phase 4) and **Redis 7** (quotes, sessions, pub/sub, jobs). |
| D7 | Hosting | **Docker Compose locally** through Phase 5; **AWS Mumbai** from Phase 6, multi-AZ, warm standby in AWS Hyderabad. ECS Fargate first, EKS if needed. Terraform. |
| D8 | Design | Same layout and information architecture as the reference, with **nthstock's own light theme** (own palette, typography, logo). Storybook is the design source. |
| D9 | Repository | **Public**: https://github.com/nareshpayani/nthstock. No secrets, keys or real user data ever committed. |
| D10 | Platforms | Desktop web first; mobile app later (React Native + Expo), so tokens, API client, contracts and utils live in `packages/*`. |
| D11 | Tooling | **npm workspaces + Turborepo** (not pnpm). ESLint + Prettier. No git hooks; CI enforces. Conventional Commits, squash merge. |

## 1. Product vision

nthstock is an Indian stock market investing and trading platform, built from scratch.
The reference UX is the Paytm Money stocks dashboard (`paytmmoney.com/stocks/dashboard`),
taken from the owner's screenshot (the live site is not reachable from the build environment).

### Reference dashboard, broken into features
| Area | What the reference shows | nthstock module |
|---|---|---|
| Top bar | Logo, live Nifty 50 and BSE Sensex tickers, nav (Dashboard, Market, Portfolio, Positions, Orders, Funds), support, profile, "More" | `layout/header`, `marketTicker` |
| Left rail | Stock search, sort, watchlist (empty state, Add Stock), promo banner, collapsible "My Watchlist" | `search`, `watchlist` |
| Hero | Greeting, onboarding CTA | `onboarding` |
| Index chart | Nifty 50 multi-year area chart with LIVE badge | `charts` |
| Promo carousel | Returns stat, partner banners, pagination dots | `banners` |
| Market Indices | Horizontal cards with sparklines | `indices` |
| Stocks List | Curated lists (Market Giants, Best Returns, Highest Dividends, Top IT…) | `collections` |
| Market Movers | Gainers/losers by index | `movers` |

## 2. Scope

### In scope (v1)
- Public market pages: dashboard, indices, stock detail, search, curated lists, movers.
- Accounts: mobile + OTP sign-up/login, PIN for repeat logins on trusted devices, optional TOTP 2FA, profile, active-sessions screen, mocked KYC status.
- Watchlists (multiple, reorderable, live prices).
- Portfolio, positions, orders, funds views.
- Paper trading: ₹10,00,000 virtual cash, delivery + intraday, market + limit orders, NSE hours and holidays enforced, resettable balance.
- Real-time quotes via WebSocket. In-app notifications only.

### Out of scope until explicitly approved
- Real-money order routing, real KYC / PAN / bank data, demat opening.
- Mutual funds, IPO, F&O, NCD, options chain.
- Native mobile app (after web v1), dark mode, other languages.

## 3. Non-functional targets
| Area | Target |
|---|---|
| Peak load | 9:15 AM IST market open. Load-tested to 10 lakh concurrent users; architecture scales horizontally to 1 crore concurrent without redesign. |
| Logins | 50,000 logins/sec peak. PIN path avoids SMS; login waiting room if over capacity. |
| Latency | Tick → screen < 500 ms. API p95 < 200 ms, p99 < 500 ms. DB p95 < 50 ms. Paper order ack < 300 ms. |
| Web vitals (Chrome) | LCP < 2.0 s, INP < 150 ms, CLS < 0.05. Initial JS < 200 KB gzipped. |
| Availability | 99.95% during market hours (9:00–15:30 IST). RPO 1 min, RTO 15 min. |
| Security | OWASP ASVS Level 2. Data stored in India. DPDP Act 2023 consent + account deletion. |

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

npm workspaces + Turborepo. Node 22 pinned in `.nvmrc`; `.npmrc` sets `engine-strict=true` and `save-exact=true`.

```
nthstock/
├── CLAUDE.md
├── apps/
│   ├── web/                   # Vite React SPA
│   │   └── src/
│   │       ├── app/           # providers, layouts (AppShell), router, queryClient
│   │       ├── routes/        # TanStack Router file routes; thin: loader prefetch → feature page
│   │       ├── features/      # dashboard, watchlist, search, stockDetail, orderTicket, orders… (ADR 0005)
│   │       │   └── <feature>/ { index.ts, components/, hooks/, api/, store/, model/, strings.ts }
│   │       ├── shared/        # cross-feature components, hooks, lib
│   │       └── mocks/         # MSW handlers
│   ├── api/                   # Fastify modular monolith
│   │   └── src/modules/<module>/ { routes.ts, service.ts, repo.ts, schema.ts, *.test.ts }
│   ├── realtime/              # WebSocket server
│   └── mobile/                # (later) React Native + Expo
├── packages/
│   ├── ui/                    # design system components + Storybook
│   ├── tokens/                # design tokens → CSS variables + Tailwind preset
│   ├── contracts/             # Zod schemas, API + WS message types
│   ├── marketData/            # feed adapters: mock (faker + GBM), vendor (later)
│   ├── paperEngine/           # order state machine, fill matching, funds ledger, P&L (ADR 0004)
│   ├── apiClient/             # typed REST + WS client (web and mobile)
│   ├── config/                # eslint, tsconfig, prettier, vitest presets
│   └── utils/                 # INR formatting, market hours, IST dates
├── infra/                     # docker-compose, terraform
├── docs/
│   ├── requirements-qa.md     # every requirement question and answer
│   ├── adr/                   # architecture decision records (NNNN-title.md)
│   ├── specs/                 # one spec per feature, approved before build
│   └── runbooks/
├── .claude/                   # agent settings, hooks, skills, subagents
└── .github/                   # workflows, PR template, CODEOWNERS
```

## 6. Conventions

### Code
- TypeScript `strict: true`; no `any` without a comment explaining why.
- Naming: camelCase for files, folders, variables and functions (`useQuotes.ts`, `formatInr.ts`); PascalCase for React component files, components and types (`WatchlistCard.tsx`). Named exports only.
- Money: never floats. Store paise as integers; format with `Intl.NumberFormat('en-IN')` (₹, lakh/crore grouping).
- Time: store UTC, display IST (`Asia/Kolkata`). Market hours and holidays live in `packages/utils`.
- Every API and WS message is typed from `packages/contracts`.
- Web UI layers and patterns follow ADR 0005: imports go routes → features → shared → packages;
  features are imported only through their `index.ts`; server state in TanStack Query, URL state in
  search params, UI-only state in Zustand; live prices only through `useQuote` / `<PriceCell>`.
- UI strings kept in one place per feature (no i18n library in v1).
- Accessibility: WCAG 2.2 AA. Colour is never the only up/down signal (▲▼ + text).

### Git and PRs
- Short-lived branches `feat/…`, `fix/…`, `chore/…`, `docs/…` off `main`.
- Conventional Commits; squash merge.
- Every PR: linked issue/spec, tests, screenshots for UI, green CI.
- `main` is protected: PR required, CI must pass, no force-push.

### Quality gates (CI must pass)
lint · format check · typecheck · unit/component tests (≥ 80% on changed packages) · build · Playwright smoke (Chrome) · bundle-size budget · Lighthouse budgets · `npm audit` · CodeQL · gitleaks.

## 7. Phased plan

Each phase ends with a demo and owner sign-off before the next starts.

| # | Phase | Goal | Exit criteria |
|---|---|---|---|
| 1 | Foundation and design system | Monorepo, CI, tokens, core components, app shell, header, routing | Green CI; Storybook published; a11y checks pass; app shell matches reference layout |
| 2 | Dashboard UI on mock data | Every dashboard section, responsive, on MSW mocks | Close match to reference; Lighthouse budgets met |
| 3 | Backend core | Auth (OTP + PIN + JWT), users, watchlists, sessions, audit log, Postgres, Redis | Contract tests pass; OpenAPI published |
| 4 | Market data | Mock feed adapter, quote service, realtime server, candles, indices | Live ticks on dashboard < 500 ms |
| 5 | Paper trading | Orders, positions, holdings, funds ledger, order state machine | End-to-end order flow tested |
| 6 | Scalability | AWS deploy, pre-scaling, Redis Cluster, replicas, load tests | 10 lakh concurrent + 50k logins/sec at target latency |
| 7 | Performance | Web Vitals and bundle budgets, RUM, backend profiling | Budgets met in CI and in RUM |
| 8 | Security and compliance | ASVS L2 review, WAF, DPDP flows, pen-test checklist | Checklist clean |
| 9 | Observability and release | Dashboards, alerts, feature flags, staged rollout | SLOs defined and monitored |

Security, testing and performance gates apply from Phase 1; phases 6–8 are hardening passes.

## 8. Agentic workflow

Humans set direction and approve; agents plan, build, test and review.

1. **Spec first.** Every feature starts as `docs/specs/<feature>.md` (problem, UX, API contract, acceptance criteria). Owner approves the spec in chat before code.
2. **Architecture changes** go through an ADR in `docs/adr/`.
3. **Tracking:** one GitHub Issue per spec/task; a GitHub Projects board per phase.
4. **Agent team** (details in `docs/agent-workflow.md`, ADR 0003): **Planner**, **Developer**, **Reviewer**, **Fixer**, running on GitHub Actions with role definitions in `.claude/agents/`. Labels drive the loop: `plan:approved` → spec PR + stories → merge spec → `agent:ready` → PR → review → `agent:fix-needed` (Fixer, same PR) or `ready-to-merge`. Once every check is green, `agent-automerge.yml` squash-merges the PR (owner decision 2026-09-26; spec PRs, drafts, Dependabot and PRs labelled `needs-human`, `agent:fix-needed` or `do-not-merge` are skipped). Max 3 review rounds, then `needs-human`.
5. **Agents may:** write specs, code and tests; open PRs; fix CI failures and review comments on their own.
6. **Agents never:** merge a PR by hand (only `agent-automerge.yml` merges, and only green PRs), push to `main`, deploy to production, touch real money, commit secrets, or add a paid service or a dependency outside the approved stack without asking.
7. **Review:** a review agent comments on every PR; green PRs merge automatically, and the owner approves specs and can hold any PR with `do-not-merge`.
8. **Environments:** local Docker Compose → free preview deploy per PR (web) → staging + prod from Phase 6.
9. **Budget:** free tiers until Phase 6; owner approves any paid service.
10. **One phase at a time.** No phase starts without owner sign-off in the project chat.

## 9. Compliance notes (to validate with a professional)
- Real trading requires a SEBI-registered broker or a broker API partner.
- NSE/BSE real-time data redistribution requires exchange licensing.
- Personal data: DPDP Act 2023; keep data in India.
- Immutable audit log for orders and funds from day one.
