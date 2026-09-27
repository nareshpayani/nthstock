import type { EngineRegistry, PaperEngine } from '@nthstock/paperEngine';
import type { OrderAccountRecord } from './schema.js';

/**
 * Storage seam for paper accounts (ADR 0004 §3): one `PaperEngine` per user. In memory now; the
 * Postgres version loads an account's rows into an engine on first use and writes its changes
 * back in one transaction.
 */
export interface OrdersRepo extends EngineRegistry {
  /** Every account as plain data (tests, and the shape Phase 3 stores). */
  export(): OrderAccountRecord[];
  /** Tests only: forget every account. */
  reset(): Promise<void>;
}

export function createMemoryOrdersRepo(): OrdersRepo {
  const engines = new Map<string, PaperEngine>();
  return {
    get: (userId) => engines.get(userId),
    set: (userId, engine) => {
      engines.set(userId, engine);
    },
    entries: () => engines.entries(),
    export: () => [...engines].map(([userId, engine]) => ({ userId, state: engine.snapshot() })),
    reset: () => {
      engines.clear();
      return Promise.resolve();
    },
  };
}
