# Product: vision, scope and plan

Moved out of CLAUDE.md on 2026-10-07 so CLAUDE.md stays short. Section numbers match the CLAUDE.md
sections that ADRs and specs cite (CLAUDE.md §1, §2, §3, §7, §9).

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

## 9. Compliance notes (to validate with a professional)
- Real trading requires a SEBI-registered broker or a broker API partner.
- NSE/BSE real-time data redistribution requires exchange licensing.
- Personal data: DPDP Act 2023; keep data in India.
- Immutable audit log for orders and funds from day one.
