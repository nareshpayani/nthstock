# CLAUDE.md — nthstock

> Status: **DRAFT v0.2** (2026-09-25). Scope decisions recorded in §0. No app code has been written.
> Owner: Naresh Payani (@nareshpayani). Every agent working on this project reads this file first.

## 0. Decisions (confirmed by owner, 2026-09-25)
| # | Topic | Decision |
|---|---|---|
| D1 | Product name | **nthstock** |
| D2 | Trading | **Paper trading only** for v1. No real-money order routing. |
| D3 | Market data | **Mock feed**: seeded NSE/BSE symbol master + random-walk (GBM) tick generator, with `@faker-js/faker` for company/user data. Adapter interface kept so a real vendor or broker API can plug in later. Unofficial free APIs (e.g. scraped Yahoo/NSE endpoints) are not used: their terms forbid redistribution. |
| D4 | Frontend | **Vite + React + TypeScript SPA**. |
| D5 | Backend | **Modular monolith** (Node.js + Fastify), split into services only when needed. |
| D6 | Database | **PostgreSQL 16** (users, watchlists, orders, ledger; needs ACID for money) + **Redis 7** (quote cache, sessions, pub/sub). Add the TimescaleDB extension to the same Postgres when historical candles arrive (Phase 4). |
| D7 | Hosting | **Docker Compose locally** through Phase 5; **AWS Mumbai (ap-south-1)** from Phase 6 for Indian data residency. Terraform for IaC. |
| D8 | Design | Same layout and information architecture as the reference, with **nthstock's own theme** (own palette, typography, logo; light + dark). |
| D9 | Repository | **Public** GitHub repo. Name pending owner confirmation (proposed `nareshpayani/nthstock`). Public means: no secrets, keys or real user data ever committed; secret scanning on in CI. |
| D10 | Platforms | **Desktop web first.** A mobile app follows later (proposed: React Native + Expo), so business logic, API client, contracts and tokens live in `packages/*`, never inside `apps/web`. |

## 1. Product vision

nthstock is an Indian stock market investing and trading platform, built from scratch.
The reference UX is the Paytm Money stocks dashboard (`paytmmoney.com/stocks/dashboard`).
The live site was not reachable from the build environment, so the reference is the
screenshot in the project uploads.

### Reference dashboard, broken into features
| Area | What the reference shows | nthstock module |
|---|---|---|
| Top bar | Logo, live Nifty 50 and BSE Sensex tickers, nav (Dashboard, Market, Portfolio, Positions, Orders, Funds), support, profile, "More" | `layout/header`, `market-ticker` |
| Left rail | Stock search, sort, watchlist (empty state, Add Stock), promo banner, collapsible "My Watchlist" | `search`, `watchlist` |
| Hero | Greeting, onboarding CTA ("open trading and demat account") | `onboarding` |
| Index chart | Nifty 50 multi-year area chart with LIVE badge | `charts` |
| Promo carousel | Returns stat, partner banners, pagination dots | `cms/banners` |
| Market Indices | Horizontal cards with sparklines (Sensex, Bank Nifty, Midcap, Smallcap…) | `indices` |
| Stocks List | Curated lists (Market Giants, Best Returns, Highest Dividends, Top IT…) | `screeners/collections` |
| Market Movers | Gainers/losers by index (Nifty 100…) | `movers` |

## 2. Scope

### In scope (MVP → v1)
- Public market pages: dashboard, indices, stock detail, search, curated lists, movers.
- Accounts: sign up, login (OTP), profile, KYC status (mocked first).
- Watchlists (multiple, reorderable, live prices).
- Portfolio, positions, orders, funds views.
- Order placement against a **paper-trading engine** first; real broker integration later.
- Real-time quotes via WebSocket.

### Out of scope until explicitly approved
- Real-money order routing to NSE/BSE (needs SEBI broker licence or a broker API partner).
- Real KYC / e-sign / demat account opening.
- Mutual funds, IPO, F&O, NCD, options chain (later phases).
- Native mobile app (planned after web v1; see D10).

## 3. Phased plan

Each phase ends with a demo and a sign-off from the owner before the next one starts.

| # | Phase | Goal | Exit criteria |
|---|---|---|---|
| 0 | Foundation | Repo, monorepo tooling, CI, lint/format/test, CLAUDE.md, ADRs, agent workflow | Green CI on an empty app; PR template; branch protection |
| 1 | Design system and UI shell | Tokens, theme (light/dark), core components, layout, header, routing | Storybook published; a11y checks pass |
| 2 | Dashboard UI on mock data | Every section of the reference dashboard, responsive, driven by a mock API (MSW) | Pixel-close to reference; Lighthouse ≥ 90 |
| 3 | Backend core | API gateway, auth (OTP + JWT), users, watchlists, Postgres, Redis | Contract tests pass; OpenAPI spec published |
| 4 | Market data | Data-feed adapter layer, quote service, WebSocket fan-out, historical candles, indices | Live ticks on the dashboard; replay mode for dev |
| 5 | Trading (paper) | Orders, positions, holdings, funds ledger, order state machine | End-to-end order flow tested |
| 6 | Scalability | Horizontal WS scaling, caching, queues, load tests | 10k concurrent WS clients at target p95 |
| 7 | Performance | Bundle budgets, SSR/streaming, virtualised lists, chart perf | Web Vitals budgets met in CI |
| 8 | Security and compliance | OWASP ASVS L2, secrets, audit log, rate limits, DPDP Act 2023, SEBI-aligned data handling | Pen-test checklist clean |
| 9 | Observability and release | Logs, metrics, traces, alerts, feature flags, staged rollouts | SLOs defined and dashboarded |

Security, testing and performance budgets apply from Phase 0; phases 6 to 8 are the hardening passes.

## 4. Architecture (proposed, pending ADRs)

```
Browser (React SPA/SSR)
   │  HTTPS (REST/JSON)        WSS (quotes)
   ▼                           ▼
API Gateway / BFF  ───────  Realtime Gateway (WebSocket)
   │                           ▲
   ├─ auth-service             │ pub/sub (Redis Streams → NATS/Kafka at scale)
   ├─ user-service             │
   ├─ watchlist-service     market-data-service ◄── Feed adapters (mock | broker API | vendor)
   ├─ order-service ── paper-trading engine
   └─ portfolio-service
        │
   PostgreSQL (+ TimescaleDB for candles)     Redis (cache, sessions, pub/sub)
```

Start as a **modular monolith** (one Node process, clear module boundaries) and split into
services only when load or team shape demands it. Module boundaries mirror the list above.

### Frontend stack (default)
- React 19 + TypeScript (strict), Vite SPA (D4).
- Routing: TanStack Router (or React Router 7).
- Server state: TanStack Query. Client state: Zustand. Real-time: a single WS client feeding a normalised quote store.
- Styling: design tokens + CSS variables, Tailwind CSS or vanilla-extract; headless primitives via Radix UI.
- Charts: TradingView Lightweight Charts (candles, area); small sparklines in SVG.
- Forms: React Hook Form + Zod.
- Testing: Vitest, React Testing Library, Playwright (E2E + visual), Storybook, axe.
- Mocking: MSW, sharing types with the backend.

### Backend stack (default)
- Node.js 22 LTS + TypeScript, Fastify.
- Validation and contracts: Zod schemas → OpenAPI, shared via `packages/contracts`.
- ORM: Drizzle (or Prisma). PostgreSQL 16. Redis 7.
- WebSocket: `ws` behind the realtime gateway, Redis pub/sub for fan-out.
- Jobs: BullMQ. Auth: OTP + short-lived JWT access + rotating refresh tokens (httpOnly cookies).
- Testing: Vitest, Supertest, Testcontainers.

### Infrastructure (default)
- Docker for local dev (`docker compose up` runs everything) through Phase 5 (D7).
- GitHub Actions for CI/CD.
- Cloud from Phase 6: AWS Mumbai (ap-south-1) for data residency; containers on ECS Fargate first, Kubernetes only if needed.
- IaC: Terraform. CDN: CloudFront.

## 5. Monorepo structure

pnpm workspaces + Turborepo.

```
nthstock/
├── CLAUDE.md                  # this file
├── apps/
│   ├── web/                   # React + TS frontend
│   │   └── src/
│   │       ├── app/           # routes, providers, layout
│   │       ├── features/      # dashboard, watchlist, search, indices, orders, portfolio…
│   │       │   └── <feature>/ { components/, hooks/, api/, store/, *.test.tsx }
│   │       ├── shared/        # cross-feature hooks, utils
│   │       └── mocks/         # MSW handlers
│   ├── api/                   # Node BFF / modular monolith
│   │   └── src/modules/<module>/ { routes.ts, service.ts, repo.ts, schema.ts, *.test.ts }
│   ├── realtime/              # WebSocket gateway
│   └── mobile/                # (later) React Native + Expo app, reuses packages/*
├── packages/
│   ├── ui/                    # design system components + Storybook
│   ├── tokens/                # design tokens (colors, type, spacing)
│   ├── contracts/             # Zod schemas, API + WS message types (shared FE/BE)
│   ├── market-data/           # feed adapters: mock (faker + GBM ticks), replay, vendor (later)
│   ├── api-client/            # typed API + WS client shared by web and mobile
│   ├── config/                # eslint, tsconfig, prettier, vitest presets
│   └── utils/                 # INR formatting, market hours, IST dates
├── infra/                     # docker-compose, terraform, k8s
├── docs/
│   ├── adr/                   # architecture decision records (NNNN-title.md)
│   ├── specs/                 # one spec per feature before build
│   └── runbooks/
├── .claude/                   # agent settings, hooks, skills, subagents
└── .github/                   # workflows, PR template, CODEOWNERS
```

## 6. Conventions

### Code
- TypeScript `strict: true`, no `any` without a comment explaining why.
- Named exports; one component per file; feature folders own their code.
- Money and prices: never floats for money. Store paise as integers (or decimal strings); format with `Intl.NumberFormat('en-IN')` (₹, lakh/crore grouping).
- Time: store UTC, display IST (`Asia/Kolkata`). Market hours and holidays live in `packages/utils`.
- Every API and WS message is typed from `packages/contracts`; no hand-written duplicates.
- Accessibility: WCAG 2.2 AA. Colour is never the only up/down signal (use ▲▼ icons and text too).

### Git and PRs
- Trunk-based: short-lived branches `feat/…`, `fix/…`, `chore/…` off `main`.
- Conventional Commits. Squash merge.
- Every PR: linked spec or issue, tests, screenshots for UI, passing CI, one reviewer (human or review agent + human for merges to `main`).

### Quality gates (CI must pass)
lint · typecheck · unit tests (≥ 80% on changed packages) · build · Playwright smoke · bundle-size budget · dependency audit · secret scan.

## 7. Agentic workflow

The project runs as an agentic team. Humans set direction and approve; agents plan, build, test and review.

1. **Spec first.** Every feature starts as `docs/specs/<feature>.md` (problem, UX, API contract, acceptance criteria). The owner approves the spec before code.
2. **Architecture changes** go through an ADR in `docs/adr/`.
3. **Roles** (Claude subagents in `.claude/agents/`):
   - *architect*: specs, ADRs, contracts.
   - *frontend*: `apps/web`, `packages/ui`.
   - *backend*: `apps/api`, `apps/realtime`.
   - *data-feed*: `packages/market-data`.
   - *qa*: tests, Playwright, visual regression.
   - *reviewer*: code/security review on every PR.
   - *devops*: CI/CD, infra.
4. **Definition of done:** spec criteria met, tests added, CI green, docs/ADR updated, PR reviewed.
5. **Automation:** Claude Code hooks run format + lint on edit; a SessionStart hook installs deps; CI runs the review agent on each PR.
6. **Guardrails:** agents never commit secrets, never touch production or real-money flows, never push to `main` directly, and ask before adding a new runtime dependency outside the approved stack above.
7. **One phase at a time.** Agents do not start the next phase without owner sign-off in the project chat.

## 8. Compliance notes (to validate with a professional)
- Real trading requires a SEBI-registered broker (or partnering with one via broker APIs such as Zerodha Kite Connect, Upstox, Angel One SmartAPI, Dhan).
- NSE/BSE real-time data redistribution requires exchange licensing; vendors or broker APIs cover this for development.
- Personal data: DPDP Act 2023; keep data in India.
- Keep an immutable audit log for orders and funds from day one.

## 9. Open questions
- Repository name (D9).
Answers get folded back into §0 and the relevant ADRs.
