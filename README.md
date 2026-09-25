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
```

| Workspace         | What it is                                                                  |
| ----------------- | --------------------------------------------------------------------------- |
| `apps/web`        | Vite + React SPA                                                            |
| `apps/api`        | Fastify API (`GET /v1/health`)                                              |
| `packages/config` | Shared ESLint and TypeScript config                                         |
| `packages/ui`     | Design system components (Radix, cva, Tailwind) and Storybook               |
| `packages/tokens` | Design tokens → `tokens.css`, Tailwind v4 theme, self-hosted IBM Plex fonts |
