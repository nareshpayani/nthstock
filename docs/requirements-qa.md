# nthstock: requirements Q&A log

> Living record of every architecture question, the recommended default, and the owner's answer.
> Status key: **Open** (waiting on owner) · **Answered** · **Default accepted**.
> Once every item is settled, answers are folded into CLAUDE.md §0 and ADRs, then Phase 1 is planned.
> All 7 rounds settled on 2026-09-25 and folded into CLAUDE.md v0.3.
> Started 2026-09-25. Already-settled decisions D1–D10 live in CLAUDE.md §0.

## Round 1: Scale targets and frontend (answered 2026-09-25)

| ID | Question | Recommended default | Answer | Status |
|---|---|---|---|---|
| S-01 | What does "1 crore users" mean: registered, daily active, or online at the same moment? | 1 crore registered, 10 lakh concurrent, scalable to 1 crore concurrent | Plan for the 9:15 AM market-open peak, whoever the users are. Design target: 10 lakh concurrent load-tested, horizontally scalable to 1 crore concurrent without redesign. | Answered |
| S-02 | Peak login rate at market open? | 50,000 logins/sec | 50,000 logins/sec. | Answered |
| S-03 | Latency targets? | Tick-to-screen < 500 ms; interactive < 2 s on 4G; API p95 < 200 ms; paper order ack < 300 ms | As recommended. | Answered |
| S-04 | Availability in market hours (9:00–15:30 IST)? | 99.95%, maintenance after hours | As recommended. | Default accepted |
| FE-01 | Browsers? | Last 2 versions of Chrome, Edge, Safari, Firefox | Chrome only (latest 2 versions) for now. | Answered |
| FE-02 | Minimum desktop width? | 1280 px, works at 1024 px | Fully responsive layout; desktop is the primary target. | Answered |
| FE-03 | Styling? | Tailwind on own tokens + Radix UI | Architect's choice: own design tokens (CSS variables) with Tailwind configured from them, Radix UI primitives. | Answered |
| FE-04 | Routing? | TanStack Router | TanStack Router. | Default accepted |
| FE-05 | State management? | TanStack Query + Zustand + live-price store | As recommended. | Answered |
| FE-06 | Charts? | TradingView Lightweight Charts + SVG sparklines | As recommended. | Default accepted |
| FE-07 | Languages? | English, i18n-ready | English only. No i18n library in v1; UI strings kept in one place per feature. | Answered |
| FE-08 | Dark mode at launch? | Yes | No dark mode. Single light theme. | Answered |
| FE-09 | Accessibility level? | WCAG 2.2 AA | As recommended. | Default accepted |
| FE-10 | Design source? | Storybook, screenshots reviewed in PRs | Storybook is the design source; owner reviews screenshots in PRs. | Answered |

## Round 2: Folder structure and code conventions (answered 2026-09-25)
| ID | Question | Recommended default | Answer | Status |
|---|---|---|---|---|
| ST-01 | Package manager and monorepo tool? | pnpm workspaces + Turborepo | npm workspaces (not pnpm) + Turborepo for task caching. | Answered |
| ST-02 | Organise apps/web by feature (features/<name>/{components,hooks,api,store})? | Yes | Yes, feature folders. | Answered |
| ST-03 | Shared code for future mobile app (tokens, API client, types, utils) in packages/* from day one? | Yes | Yes. | Answered |
| ST-04 | Naming: kebab-case files, PascalCase components, named exports only? | Yes | camelCase for files, variables and functions (e.g. useQuotes.ts, formatInr.ts); PascalCase for React component files and types (e.g. WatchlistCard.tsx), per React convention; named exports only. | Answered |
| ST-05 | ESLint + Prettier, or Biome? | ESLint + Prettier | ESLint + Prettier. | Answered |
| ST-06 | Pre-commit hooks (Husky + lint-staged)? | Yes | No git hooks for now; CI enforces lint/format. | Answered |
| ST-07 | Conventional Commits, squash merge? | Yes | Yes. | Answered |
| ST-08 | Node version? | Node 22 LTS pinned in .nvmrc | Node 22 LTS. .nvmrc pins the Node version; .npmrc sets npm behaviour (engine-strict=true, save-exact=true); package.json "engines" backs both. | Answered |
| ST-09 | Separate apps/realtime WebSocket server from apps/api so each scales independently? | Yes | Yes, separate apps/realtime. | Answered |

## Round 3: Backend and APIs (answered 2026-09-25)
| ID | Question | Recommended default | Answer | Status |
|---|---|---|---|---|
| BE-01 | API style: REST, GraphQL, or tRPC? | REST + OpenAPI generated from Zod schemas; WebSocket for live prices | As recommended. | Default accepted |
| BE-02 | API versioning? | URL prefix /v1 | As recommended. | Default accepted |
| BE-03 | Backend framework? | Fastify (roughly 2x Express throughput, built-in schema validation) | As recommended. | Default accepted |
| BE-04 | ORM / database access? | Drizzle (SQL-first, typed, lightweight) | As recommended. | Default accepted |
| BE-05 | Login method? | Mobile number + OTP, plus a 4–6 digit PIN for repeat logins on a trusted device; TOTP 2FA optional; no social login in v1 | As recommended. | Default accepted |
| BE-06 | Session model? | 15-min JWT access token + rotating refresh token in httpOnly cookie, revocable via Redis | As recommended. | Default accepted |
| BE-07 | SMS/OTP provider? | Mock provider (OTP printed in logs) until public launch; real provider chosen then | As recommended. | Default accepted |
| BE-08 | Paper-trading rules? | ₹10,00,000 virtual cash; delivery + intraday; market + limit orders; NSE hours and holidays enforced; resettable balance | As recommended. | Default accepted |
| BE-09 | Stock universe? | All NSE + BSE equities from a seeded symbol master (~5,000 symbols); indices as shown in reference | As recommended. | Default accepted |
| BE-10 | Background jobs? | BullMQ on Redis (EOD settlement, P&L snapshots) | As recommended. | Default accepted |
| BE-11 | Notifications in v1? | In-app only; email/push later | As recommended. | Default accepted |

## Round 4: Security and compliance (answered 2026-09-25)
| ID | Question | Recommended default | Answer | Status |
|---|---|---|---|---|
| SEC-01 | Security baseline standard? | OWASP ASVS Level 2, checked each phase | As recommended. | Default accepted |
| SEC-02 | Rate limiting and bot protection? | Per-IP and per-user limits (Redis); OTP resend throttling; CAPTCHA after 3 failed OTP/PIN attempts; AWS WAF + Shield in cloud | As recommended. | Default accepted |
| SEC-03 | Account lockout? | Lock PIN after 5 wrong attempts; unlock via OTP | As recommended. | Default accepted |
| SEC-04 | Secrets management? | .env locally, never committed (.env.example only); AWS Secrets Manager in cloud | As recommended. | Default accepted |
| SEC-05 | Encryption? | TLS 1.2+ everywhere, HSTS; encryption at rest (KMS); phone/PII encrypted at column level; PINs hashed with Argon2id | As recommended. | Default accepted |
| SEC-06 | Browser security headers? | Strict CSP, X-Frame-Options DENY, SameSite=Strict cookies, CSRF token on state-changing requests | As recommended. | Default accepted |
| SEC-07 | Audit log? | Append-only log of logins, orders and fund movements from Phase 3 | As recommended. | Default accepted |
| SEC-08 | Automated scanning in CI? | Dependabot, npm audit, CodeQL, gitleaks secret scan | As recommended. | Default accepted |
| SEC-09 | Active sessions screen (see and log out other devices)? | Yes, Phase 3 | As recommended. | Default accepted |
| SEC-10 | PAN / KYC / bank data in v1? | Not collected; KYC status mocked | As recommended. | Default accepted |
| SEC-11 | Data residency and privacy? | All data stored in India (AWS Mumbai); DPDP Act 2023 consent screen and delete-my-account flow | As recommended. | Default accepted |

## Round 5: Scalability for the 9:15 AM peak (answered 2026-09-25)
| ID | Question | Recommended default | Answer | Status |
|---|---|---|---|---|
| SC-01 | Stateless API servers behind a load balancer with autoscaling? | Yes; no server-side state outside Redis/Postgres | As recommended. | Default accepted |
| SC-02 | Scale reactively only, or pre-scale before market open? | Scheduled pre-scale at 8:45 AM IST to peak capacity, plus reactive autoscaling; scale down after 3:45 PM | As recommended. | Default accepted |
| SC-03 | Live price fan-out design? | Dedicated realtime nodes; clients subscribe only to symbols on screen; ticks merged to max 4 updates/sec per symbol; binary compact messages; Redis pub/sub now, NATS JetStream at scale | As recommended. | Default accepted |
| SC-04 | Login at scale? | Trusted-device PIN path avoids SMS; sessions in Redis Cluster; login waiting room if over capacity | As recommended. | Default accepted |
| SC-05 | Database scaling? | Postgres primary + read replicas + PgBouncer pooling; orders partitioned by day; shard by user_id (Citus) only when a single primary is not enough | As recommended. | Default accepted |
| SC-06 | Caching? | CDN for static assets and public market snapshots (indices, lists, movers) with 1–5 s TTL; Redis for quotes, sessions, hot lists | As recommended. | Default accepted |
| SC-07 | Graceful degradation under overload? | Shed non-critical features first (promos, movers, charts history), keep login, prices, orders alive | As recommended. | Default accepted |
| SC-08 | Resilience? | Multi-AZ in AWS Mumbai; warm standby in AWS Hyderabad for disaster recovery (RPO 1 min, RTO 15 min) | As recommended. | Default accepted |
| SC-09 | Container platform? | ECS Fargate first; move to EKS (Kubernetes) if scale or cost demands | As recommended. | Default accepted |
| SC-10 | Load-testing plan? | k6 in stages: 1 lakh → 10 lakh concurrent sockets, 50k logins/sec; 1 crore validated by extrapolation + one large paid test before launch | As recommended. | Default accepted |

## Round 6: Performance (answered 2026-09-25)
| ID | Question | Recommended default | Answer | Status |
|---|---|---|---|---|
| PF-01 | Core Web Vitals budgets (Chrome, mid-range laptop)? | LCP < 2.0 s, INP < 150 ms, CLS < 0.05; enforced by Lighthouse CI | As recommended. | Default accepted |
| PF-02 | JavaScript bundle budget? | Initial JS < 200 KB gzipped; route-level code splitting; charts lazy-loaded; size-limit check in CI | As recommended. | Default accepted |
| PF-03 | Rendering live prices? | Updates batched per animation frame; each price cell subscribes to its own symbol so only changed cells re-render; up/down flash via CSS only | As recommended. | Default accepted |
| PF-04 | Long lists (watchlist, stock lists, 5,000-symbol search)? | Virtualised with TanStack Virtual; search served from an in-memory index on the API | As recommended. | Default accepted |
| PF-05 | First load? | Preload critical fonts (self-hosted, subset); SVG icons; images in AVIF/WebP; skeleton loaders instead of spinners | As recommended. | Default accepted |
| PF-06 | Offline / repeat visit speed? | Service worker caches the app shell and static assets (PWA), so repeat loads are near-instant | As recommended. | Default accepted |
| PF-07 | Real-user monitoring? | Web Vitals sent from real sessions to our observability stack; alerts when budgets regress | As recommended. | Default accepted |
| PF-08 | Backend performance budgets? | API p95 < 200 ms, p99 < 500 ms; DB queries < 50 ms p95; slow-query log reviewed each phase | As recommended. | Default accepted |

## Round 7: Testing, DevOps and agentic workflow (answered 2026-09-25)
| ID | Question | Recommended default | Answer | Status |
|---|---|---|---|---|
| WF-01 | Agent autonomy? | Agents write specs, code, tests; open PRs; fix CI and review comments on their own. Agents never merge, never deploy to production, never touch real money. | As recommended. | Default accepted |
| WF-02 | Merge approval? | A review agent comments first; owner approves and merges every PR into main | As recommended. | Default accepted |
| WF-03 | Spec approval? | Each feature spec (docs/specs) approved by owner in chat before code starts | As recommended. | Default accepted |
| WF-04 | Task tracking? | GitHub Issues (one per spec/task) + a GitHub Projects board per phase | As recommended. | Default accepted |
| WF-05 | Testing approach? | Unit (Vitest) + component (RTL) + contract tests on API + Playwright E2E on Chrome; 80% coverage on changed packages | As recommended. | Default accepted |
| WF-06 | Environments? | local (Docker Compose) → preview deploy per PR for web (free tier) → staging + prod from Phase 6 | As recommended. | Default accepted |
| WF-07 | Observability? | OpenTelemetry → Grafana stack (Prometheus, Loki, Tempo); Sentry for frontend errors (free tier) | As recommended. | Default accepted |
| WF-08 | Paid tools and cloud budget? | Free tiers until Phase 6; owner approves any paid service before it is added | As recommended. | Default accepted |
| WF-09 | Branch protection on main? | Owner enables: PR required, CI checks required, no force-push | As recommended. | Default accepted |
