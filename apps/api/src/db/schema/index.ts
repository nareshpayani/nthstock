// Drizzle table definitions, one file per module (`schema/<module>.ts`), re-exported here.
// Changing a table means running `npm run db:generate -w @nthstock/api` and committing the
// migration it writes; `npm run db:check` fails CI otherwise (ADR 0007).
//
// No tables yet: the baseline migration (drizzle/0000_baseline.sql) only sets privileges. The audit
// log (E12) is the first table.
export {};
