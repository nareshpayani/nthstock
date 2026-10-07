---
name: database-migrations
description: Change the nthstock Postgres schema safely with Drizzle (add, rename or drop columns and tables, add indexes and constraints, backfill data) so the running app keeps working during and after the deploy. Use when a story touches apps/api/src/db/schema or apps/api/drizzle.
---

# Database migrations

Read `.claude/rules/backend.md` and [ADR 0007](../../../docs/adr/0007-postgres-persistence-and-jobs.md)
first; the `new-api-module` skill covers the everyday commands. This skill is for changes that
could break a running app or lock a busy table.

## How migrations run here
- `npm run db:generate -w @nthstock/api` writes `apps/api/drizzle/NNNN_<name>.sql` from the schema
  in `src/db/schema/`; add `-- --custom` for hand-written SQL (deferrable constraints, `CHECK`s
  Drizzle cannot express). `npm run db:check -w @nthstock/api` must pass.
- `npm run db:migrate` applies pending files as `nthstock_owner`. The Drizzle migrator runs them
  **inside one transaction**, so `CREATE INDEX CONCURRENTLY` and other non-transactional
  statements cannot go in a migration file.
- There are no down migrations. A mistake is fixed by a new forward migration, never by editing a
  merged one (a hook blocks that).
- From Phase 6 the old and new app versions run side by side during a rolling deploy, so every
  migration must work with the code before it **and** the code after it.

## Safe patterns
| Change | Do | Never |
|---|---|---|
| Add a column | Nullable, or `NOT NULL DEFAULT <constant>` (no table rewrite on PG 16) | `NOT NULL` with no default on a table with rows |
| Add a constraint | `CHECK … NOT VALID` in one migration, `VALIDATE CONSTRAINT` in the next | A validating `CHECK`/FK on a big table in one step |
| Add an index, small table (< ~1 M rows) | Plain `CREATE INDEX` in the migration | — |
| Add an index, large table | `CREATE INDEX CONCURRENTLY IF NOT EXISTS` run as a separate step (runbook or job), then a migration that only records it | `CONCURRENTLY` inside a migration file (fails in a transaction) |
| Rename a column | Expand–contract: add the new column → write both → backfill → read new → stop writing old → drop old, over separate PRs | `RENAME COLUMN` while deployed code reads the old name |
| Drop a column or table | Remove every read and write first (one PR), drop in a later PR | Drop in the same PR that stops using it |
| Change a type | New column of the new type + backfill + switch, as a rename | `ALTER COLUMN … TYPE` that rewrites a busy table |
| Backfill data | A batched job (1,000–10,000 rows per transaction, keyset by id, resumable), outside the migration | One `UPDATE` over every row in the migration |

Money stays integer paise (`bigint`), times `instant()` (`timestamptz(3)`), PII in the
`db/crypto.ts` ciphertext and blind-index columns. Grant nothing new to `nthstock_app` beyond what
it needs; role changes go in a migration and in `infra/postgres/init.sql` for fresh databases.

## Before opening the PR
1. Apply on a fresh database and on one at the previous release: `npm run infra:up`, then
   `npm run db:migrate`. Reset with `docker compose -f infra/docker-compose.yml down -v`.
2. Run the module's `*.integration.test.ts` and `apps/api/src/db/*.integration.test.ts`.
3. In the PR body, say what each step locks and for how long, whether it is safe beside the
   previous app version, and how to recover if it goes wrong.
4. The Reviewer runs the `database-reviewer` agent on it.

Adapted from ECC `skills/database-migrations` (MIT, see `../../third-party-notices.md`).
