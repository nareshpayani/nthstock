/**
 * The funds module stores nothing of its own. The funds summary, the append-only ledger and the
 * reset act on each user's paper account (the orders module's `PaperEngine`, ADR 0004), whose
 * `FundsLedger` keeps every entry in integer paise. Request and response schemas live in
 * `packages/contracts` (`portfolio.ts`: `FundsSummary`, `LedgerEntry`, `LedgerPage`,
 * `ResetRequest`). Phase 3 maps the ledger to an append-only Postgres table.
 */
export type FundsUserId = string;
