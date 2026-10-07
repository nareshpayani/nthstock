---
name: quality-checks
description: Run the same checks CI runs (format, lint, typecheck, tests, build, Postgres and Redis integration tests, Playwright) before pushing nthstock changes. Use before every push or when CI is red.
---

# Run the quality checks locally

CI (`.github/workflows/ci.yml`) is the gate; these commands reproduce it. Never push red.

| What | Command |
| --- | --- |
| Everything fast (format, lint, typecheck, unit tests, build) | `npm run check` |
| One workspace | `npm run typecheck -w @nthstock/web`, `npm run test -w @nthstock/api`, … |
| Only what changed | `npx turbo run lint typecheck test --filter=...[origin/main]` |
| Format the repo | `npm run format` |
| Postgres and Redis integration tests | start them (`npm run infra:up`), then `npm run test -w @nthstock/api` |
| Playwright in msw mode / api mode | `npm run e2e` / `npm run e2e:api` |
| Web vitals and bundle budgets | `npm run e2e:perf` |
| Dependency audit | `npm audit --audit-level=high` |
| Drizzle schema matches migrations | `npm run db:check -w @nthstock/api` |

Integration tests use `POSTGRES_TEST_URL` and `REDIS_TEST_URL` when set (a local server works), and
are skipped locally only with `SKIP_PG_INTEGRATION=1` / `SKIP_REDIS_INTEGRATION=1`. CI never skips them.

The Claude hooks in `.claude/hooks` already format and lint each file you edit and type-check the
changed workspaces when you stop, so most problems surface before this step.

## When CI is red
1. Read the failing job's log and reproduce the failure locally with the command above.
2. Fix the cause. Never skip, disable or quarantine a test, and never re-run to "fix" a flake.
3. If the failure is on main too, fix it on main through its own PR and port that change.
