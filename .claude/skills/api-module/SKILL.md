---
name: api-module
description: Add or extend a backend module in apps/api (routes, service, repo with memory and Postgres implementations, schema, migrations, tests). Use for any nthstock backend story.
---

# Build an API module (apps/api)

ADR 0004 (storage seams) and ADR 0007 (Postgres) are the source of truth; this is the checklist.

## Where things go
```
packages/contracts/src/<area>.ts          Zod request/response schemas and the /v1 route map entry
apps/api/src/modules/<module>/            camelCase folder
  routes.ts       Fastify routes: validate with the contract schema, call the service, nothing else
  service.ts      business rules; depends on repo interfaces, never on Fastify or a driver
  repo.ts         the repo interface plus the in-memory implementation (createMemoryXxxRepo)
  pgRepo.ts       the Postgres implementation (createPgXxxRepo), Drizzle only
  schema.ts       module-local types and Zod helpers not shared with clients
  *.test.ts       unit tests next to the file they test
  repo.test.ts    the conformance suite, run against every implementation via test/conformance.ts
  postgres.integration.test.ts   behaviour only Postgres can show (locks, constraints, concurrency)
apps/api/src/db/schema/<table>.ts         Drizzle tables; money columns are bigint paise
apps/api/drizzle/                         migrations: generate with `npm run db:generate -w @nthstock/api`
apps/api/src/deps.ts                      wire the memory or Postgres repo by DB_DRIVER
```

## Rules
- Every request and response is typed from `packages/contracts`; the OpenAPI doc comes from it.
- Money is integer paise (bigint in Postgres); time is stored UTC and shown IST.
- Logins, orders and fund movements write an audit row in the same transaction (append-only).
- PII columns go through `db/crypto.ts`; never log PII or secrets.
- The app role `nthstock_app` must not need UPDATE/DELETE on append-only tables.
- No new dependency without the owner's approval.

## Steps
1. Add or update the contract and its tests in `packages/contracts`.
2. Write the repo interface and the memory implementation, then the conformance suite.
3. Add the Drizzle table, generate the migration, then `pgRepo.ts`; run the conformance suite on
   Postgres (see the `quality-checks` skill for the test database).
4. Write the service and routes with tests; wire both drivers in `deps.ts`.
5. Make sure the dual-backend scenario suites (`src/scenarios.test.ts`) pass on memory, Postgres and MSW.
