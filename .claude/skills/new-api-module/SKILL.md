---
name: new-api-module
description: Add a new module (or a new route or table in one) to the Fastify API in apps/api, with contract, in-memory and Postgres repositories, migration and tests. Use when a story adds a backend capability.
---

# Add an API module

Read `.claude/rules/backend.md` first.

1. Contract: add or extend the Zod schemas and the route entry in `packages/contracts` (paths under
   `/v1`, money as `Paise`, times as ISO UTC). Add scenarios to the contract test suite.
2. Module folder `apps/api/src/modules/<moduleName>/`:
   - `routes.ts`: register with `registerRoute` from `http/registerRoute.ts`, auth and CSRF where it
     changes state.
   - `service.ts`: the rules, no Fastify or SQL.
   - `repo.ts`: the interface + in-memory implementation; `pgRepo.ts`: the Postgres one.
   - wire both in `deps.ts`.
3. Database: table in `src/db/schema/<area>.ts`, then `npm run db:generate -w @nthstock/api` (add
   `-- --custom` for hand-written SQL) to add `drizzle/NNNN_<name>.sql`, and `npm run db:check -w
   @nthstock/api`. Apply locally with `npm run db:migrate -w @nthstock/api`. Never edit a merged
   migration.
4. Audit any login, order or fund movement through `modules/audit`.
5. MSW parity: implement the same contract in `apps/web/src/mocks/handlers/` so mock mode matches.
6. Tests: `service`/`routes` tests beside the code, `*.integration.test.ts` for `pgRepo.ts`, and the
   shared scenario suite against both backends.
7. Run the `run-checks` skill.
