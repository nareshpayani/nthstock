---
name: run-checks
description: Run nthstock's quality gate (format, lint, typecheck, tests, build) the way CI does, and read the results. Use before opening or updating a PR, after a refactor, or when asked whether the code is green.
---

# Run the quality gate

1. Use Node 22 (`.nvmrc`). If `node -v` is not v22, on the owner's Mac run
   `export PATH="$(brew --prefix node@22)/bin:$PATH"`; elsewhere `nvm use 22`.
2. Install if `node_modules` is missing or `package-lock.json` changed: `npm ci` (CI) or `npm install`.
3. Run everything: `npm run check` (format check, lint, typecheck, tests with coverage, build).
4. Faster loops while working:
   - one package: `npx turbo run lint typecheck test --filter=@nthstock/<name>`
   - only what changed vs `main`: `npx turbo run lint typecheck test --filter='...[origin/main]'`
   - format: `npm run format` (writes), `npm run format:check` (checks)
5. Integration tests need Docker (Testcontainers). Without Docker run with
   `SKIP_REDIS_INTEGRATION=1 SKIP_PG_INTEGRATION=1`; coverage in `apps/realtime` and `apps/api` can then
   fall under 80%, which is expected locally. CI runs them all.
6. E2E: `npm run e2e` (msw mode); `npm run e2e:api` needs Docker.

Report results as: what ran, pass/fail per step, and the first real error with file:line. Never
weaken, skip or delete a test to get green.
