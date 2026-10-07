---
paths:
  - "apps/api/**"
  - "apps/realtime/**"
---

# Backend standards (apps/api, apps/realtime)

Sources: [ADR 0004](../../docs/adr/0004-mock-backend-and-paper-engine.md),
[ADR 0007](../../docs/adr/0007-postgres-persistence-and-jobs.md),
[spec backend-core](../../docs/specs/backend-core.md), security baseline in
[architecture §4](../../docs/architecture.md).

## API module layout (`apps/api/src/modules/<module>/`)
| File | Holds |
|---|---|
| `routes.ts` | Fastify routes registered through `http/registerRoute.ts` with the contract from `packages/contracts` |
| `service.ts` | Business rules; no Fastify, no SQL |
| `repo.ts` | The storage interface plus the in-memory implementation |
| `pgRepo.ts` | The Postgres implementation of the same interface (Drizzle) |
| `schema.ts` | Stored shapes and module-local Zod |
| `<concern>.ts` | A focused piece when a module grows (auth: `otpService.ts`, `pinService.ts`, …) |
| `*.test.ts` | Beside the code; `*.integration.test.ts` for Postgres/Redis via Testcontainers |

Not every module needs every file. Cross-module wiring lives in `deps.ts`; HTTP plumbing in `http/`;
tables in `db/schema/<area>.ts`; migrations in `apps/api/drizzle/NNNN_snake_name.sql` (never edit a
migration that has merged; add a new one).

## Rules
- Every request, response and WS message is validated with the Zod contract from `packages/contracts`.
- Money is integer paise; times are UTC `timestamptz`; display formatting stays in the web app.
- Errors are `ApiError` with a stable `code`; never leak stack traces, SQL or tokens.
- State-changing routes need auth + CSRF; rate limits per IP and per user on auth routes.
- Personal data is column-encrypted (`db/crypto.ts`); never log PII, OTPs, PINs or tokens.
- The audit log is append-only: insert through `modules/audit`, never update or delete.
- Services are stateless; anything shared goes to Postgres or Redis so instances scale out.
- Config comes from env parsed in `config.ts`; add every new variable to `.env.example`.

## Realtime (`apps/realtime/src`)
- `connections/`: auth, the per-connection hub, the subscription registry (200 symbols max).
- `feeds/`: Redis quote, order and session-revocation feeds. Conflate to 4 updates/s per symbol,
  binary frames from `packages/contracts`.
