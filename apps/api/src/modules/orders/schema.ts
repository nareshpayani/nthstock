import type { PaperEngineSnapshot } from '@nthstock/paperEngine';

/**
 * Stored shapes of the orders module. The request and response schemas live in
 * `packages/contracts` (`orders.ts`, `portfolio.ts`).
 *
 * In the mock phase a user's paper account is one live `PaperEngine` held in memory (orders,
 * funds ledger, positions and holdings together), one per user. `PaperEngineSnapshot` is that
 * account as plain rows-to-be: Phase 3 maps its `orders` and `ledger` to append-only Postgres
 * tables (orders partitioned by day, CLAUDE.md §4) and its positions and holdings to their own.
 */
export type OrderAccountRecord = {
  userId: string;
  state: PaperEngineSnapshot;
};
