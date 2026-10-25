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
| Candle history | `npm run db:seed:candles` (also run by `seed:demo`) | | Docker, migrated database |
| Storybook | `npm run storybook` | http://localhost:6006 | |
| Candle writer | `npm run dev -w @nthstock/quotes`, then `npm run dev:candles -w @nthstock/api` | | `infra:up` and `db:migrate`; `SHARDS` as apps/quotes |

The candle writer is not part of `dev:api`: it folds apps/quotes' tick streams into `candles_1m`,
so run it beside apps/quotes when you need stored 1-minute bars.

Candle history (NSTOCK-0374): `npm run db:seed:candles` writes 2 years of daily bars and the last
30 days (at least 22 sessions) of 1-minute bars into `candles_1m`, ending with the latest closed
session, from the deterministic generator: the same rows on every machine. One-minute bars go to
the indices and the NIFTY 50, SENSEX, NIFTY BANK and NIFTY IT members (about 65 symbols); add
`-- --all` for daily history on all ~5,000 symbols, and `-- --as-of=2026-10-23T12:00:00Z` to pin
the as-of time. Rerunning with the same as-of gives the same rows. It writes as `DATABASE_URL`
(nthstock_app) and refreshes the continuous aggregates as `DATABASE_MIGRATION_URL`
(nthstock_owner; the app role may not); both default to the local Compose database. Without
DATABASE_MIGRATION_URL it refuses to run: history that is never materialised drops out of reads
once a refresh policy runs. Symbols it did not seed keep the generated charts.

Stop: Ctrl+C in its terminal, or `kill $(lsof -ti :5173)`.

Troubleshooting:
- `EBADENGINE` on install → wrong Node; switch to 22.
- Blank page or "unavailable" cards in mock mode → the MSW service worker is not in control: reload
  normally (Cmd+R). The Claude desktop app's built-in browser cannot run the worker; use Chrome.
- Port busy → `lsof -ti :5173` to find the old server.
- After `git pull`, errors about missing modules → `npm install`.
- Docker errors in `dev:api` → start Docker Desktop, then `npm run infra:up`.
More: `docs/runbooks/local-demo.md`.
