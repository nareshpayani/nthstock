# 0002. Core stack

- Status: Accepted
- Date: 2026-09-25

## Context

Requirements are recorded in `docs/requirements-qa.md`. Key drivers: 9:15 AM market-open peak,
tick-to-screen under 500 ms, a single-owner team working with AI agents, and a later mobile app.

## Decision

- **Web:** React 19 + TypeScript strict, Vite SPA, TanStack Router/Query, Zustand, Tailwind built
  from our own design tokens, Radix UI, TradingView Lightweight Charts. Chrome only, light theme.
- **API:** Node.js 22 + Fastify modular monolith, REST `/v1`, Zod contracts → OpenAPI, Drizzle ORM.
- **Realtime:** separate WebSocket server so it scales independently of the API.
- **Data:** PostgreSQL 16 (+ TimescaleDB later), Redis 7.
- **Testing:** Vitest, React Testing Library, Playwright, Storybook + axe.

## Consequences

- One language (TypeScript) end to end; contracts shared through `packages/contracts`.
- Fastify gives higher throughput than Express at the cost of a smaller plugin ecosystem.
- A SPA needs no server rendering; public SEO pages are out of scope for v1.
