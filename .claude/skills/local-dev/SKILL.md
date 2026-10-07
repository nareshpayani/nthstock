---
name: local-dev
description: Start, stop and troubleshoot the nthstock app locally (mock mode, API mode, Storybook). Use when asked to run the app, open it in a browser, or when it shows errors locally.
---

# Run nthstock locally

Always Node 22 first (see the `run-checks` skill), then `npm install` after pulling.

| Mode | Command | URL | Needs |
|---|---|---|---|
| Mock (default) | `npm run dev -w @nthstock/web` | http://localhost:5173 | nothing else |
| Full stack | `npm run dev:api` | http://localhost:5173 | Docker (Postgres, Redis) |
| Demo data | add `?demo=1` to the URL (mock) or `npm run seed:demo` (API) | | log in as 9000000001, OTP 123456 |
| Storybook | `npm run storybook` | http://localhost:6006 | |

Stop: Ctrl+C in its terminal, or `kill $(lsof -ti :5173)`.

Troubleshooting:
- `EBADENGINE` on install → wrong Node; switch to 22.
- Blank page or "unavailable" cards in mock mode → the MSW service worker is not in control: reload
  normally (Cmd+R). The Claude desktop app's built-in browser cannot run the worker; use Chrome.
- Port busy → `lsof -ti :5173` to find the old server.
- After `git pull`, errors about missing modules → `npm install`.
- Docker errors in `dev:api` → start Docker Desktop, then `npm run infra:up`.
More: `docs/runbooks/local-demo.md`.
