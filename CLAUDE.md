# CLAUDE.md — nthstock

> Owner: Naresh Payani (@nareshpayani). Every agent reads this file first; it stays short and links
> the detail. Status (2026-10-09): Phase 1 (T-001 to T-175) done on the mock backend. Phase 2, backend
> core on PostgreSQL (`docs/specs/backend-core.md`, T-176 to T-244), is in progress: epics E11 to E14
> merged, owner restarted work on 2026-10-09 with E15 (orders persistence), E16 to E21 open. Issue
> keys: T-181 is NSTOCK-0181, epics E1 to E21 are NSTOCK-0245 to NSTOCK-0265.

nthstock is an Indian stock-market investing and paper-trading platform: a React SPA, a Fastify API
and a realtime WebSocket server, built on mock NSE/BSE data. Section numbers below are stable: ADRs,
specs and code comments cite them (`CLAUDE.md §4`).

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
| D11 | Tooling | **npm workspaces + Turborepo** (not pnpm). ESLint + Prettier. No git hooks; CI enforces (CI agent runners install a pre-push guard against pushing to `main`). Claude Code hooks in `.claude/hooks/` give agents the same checks while they edit. Conventional Commits scoped by issue key (`feat(NSTOCK-0001): …`, owner decision 2026-10-07), squash merge. |

## 1. Product vision → [docs/product.md §1](docs/product.md)
Reference UX: the Paytm Money stocks dashboard, its layout and information architecture only (D8).

## 2. Scope → [docs/product.md §2](docs/product.md)
In v1: market pages, accounts (OTP, PIN, TOTP), watchlists, portfolio, paper trading with
₹10,00,000 virtual cash, live quotes. Out until approved: real money, real KYC, MF/IPO/F&O, mobile app.

## 3. Non-functional targets → [docs/product.md §3](docs/product.md)
Tick → screen < 500 ms · API p95 < 200 ms · LCP < 2.0 s, INP < 150 ms, CLS < 0.05 · initial JS
< 200 KB gzipped · 99.95% in market hours · OWASP ASVS L2 · DPDP Act 2023.

## 4. Architecture → [docs/architecture.md §4](docs/architecture.md)
SPA → `apps/api` (REST `/v1`) and `apps/realtime` (WS), PostgreSQL + Redis, mock market adapter.
The security baseline, stacks and scalability rules live there; ADRs in `docs/adr/`.

## 5. Repository map → [docs/architecture.md §5](docs/architecture.md)
```
apps/web        React SPA: app/ → routes/ → features/<feature>/ → shared/ (ADR 0005)
apps/api        Fastify: modules/<module>/{routes,service,repo,pgRepo,schema}.ts, db/, http/
apps/realtime   WebSocket server: connections/, feeds/
packages/*      ui, tokens, contracts, marketData, paperEngine, apiClient, config, utils
docs/           product, architecture, adr/, specs/, agent-workflow, runbooks/ (index: docs/README.md)
.claude/        agents/, rules/, skills/, hooks/, settings.json (see "Claude Code setup")
```

## 6. Conventions (the non-negotiables; detail in `.claude/rules/`)
- TypeScript `strict`; no `any` without a comment saying why.
- Names: camelCase files, folders, variables, functions; PascalCase components, component files and
  types; UPPER_SNAKE_CASE module constants. Named exports only (default only where tooling needs it).
- Money is integer paise (the `Paise` contract type), never floats. Time: store UTC, show IST.
- Every API and WS message is typed from `packages/contracts`.
- Web imports go routes → features → shared → packages; a feature is imported only via its `index.ts`.
- Accessibility WCAG 2.2 AA; colour is never the only up/down signal.
- Branches `feat|fix|chore|docs/…` off `main`, squash merge, every PR green. Issues are titled
  `NSTOCK-0001 : create login flow` (stories are sub-issues of their epic) and PR titles are
  `feat(NSTOCK-0001): create login flow` (`.claude/rules/git-and-prs.md`).
- Quality gate = `npm run check` (format, lint, typecheck, tests, build), plus E2E, budgets and
  security scans in CI.

## 7. Phased plan → [docs/product.md §7](docs/product.md)
Each phase ends with a demo and owner sign-off before the next starts.

## 8. Agentic workflow → [docs/agent-workflow.md](docs/agent-workflow.md)
1. **Spec first:** `docs/specs/<feature>.md`, opened as a PR labelled `spec`; merging it is approval.
2. **Architecture changes** go through an ADR in `docs/adr/`.
3. **Agents** (Planner, Developer, Reviewer, Fixer; roles in `.claude/agents/`) run on GitHub
   Actions. Green non-spec PRs labelled `ready-to-merge` auto-merge (ADR 0006). The owner merges spec
   PRs and PRs touching `.github/`, `.claude/` or `CLAUDE.md`.
4. **Done means closed:** a PR lists `Closes #N` for every issue it completes.
5. **Agents never** push to `main`, deploy, touch real money, commit secrets, or add a paid service or
   a dependency outside the approved stack without asking.
6. **One phase at a time:** no phase starts without owner sign-off in the project chat.

## 9. Compliance notes → [docs/product.md §9](docs/product.md)
SEBI broker needed for real trading; exchange licence for real-time data; DPDP Act; immutable audit log.

## Commands
Node 22 is required (`.nvmrc`). On the owner's Mac: `export PATH="$(brew --prefix node@22)/bin:$PATH"`.
| Task | Command |
|---|---|
| Install | `npm install` |
| Web app on mocks (no servers) | `npm run dev -w @nthstock/web` → http://localhost:5173 |
| Web + API + realtime (needs Docker) | `npm run dev:api` |
| Full quality gate | `npm run check` |
| One package | `npx turbo run test --filter=@nthstock/<name>` |
| E2E (Chrome) | `npm run e2e` |
| Storybook | `npm run storybook` → http://localhost:6006 |

## Claude Code setup (`.claude/`)
| Path | What it holds |
|---|---|
| `agents/` | Planner, Developer, Reviewer, Fixer roles (used by GitHub Actions), and the report-only specialists the Reviewer calls: `frontend-reviewer`, `security-reviewer`, `database-reviewer`, `silent-failure-hunter`, `test-gap-analyzer`; plus `e2e-author` for Playwright specs |
| `rules/` | Detailed standards, loaded when you work in matching paths: `frontend`, `backend`, `packages`, `testing`, `git-and-prs` |
| `skills/` | Repeatable procedures: `run-checks`, `local-dev`, `new-web-feature`, `new-api-module`, `browser-qa`, `production-audit`, `database-migrations`, `latency` |
| `hooks/` | Automatic checks (see `hooks/README.md`): format + lint after each edit, typecheck of changed workspaces at the end of a turn, guards against pushing to `main` and editing secrets or generated files |
| `settings.json` | Hook wiring and shared permissions |

File names inside `.claude/` are kebab-case because Claude Code requires it for skill names; the
camelCase rule in §6 applies to source code.
