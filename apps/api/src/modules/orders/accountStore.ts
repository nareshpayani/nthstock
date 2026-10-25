import type {
  LedgerPage,
  OrderHistoryResponse,
  OrdersPage,
  OrderStatus,
} from '@nthstock/contracts';
import type { PaperEngineWorkingSet } from '@nthstock/paperEngine';
import type { NewAuditRecord } from '../audit/index.js';

/**
 * Storage seam for paper accounts (ADR 0007 §3, spec backend-core §5.3), replacing `OrdersRepo`:
 * the per-user `PaperEngine` is a cache and this store is the record. An account is loaded as a
 * working set with a version, and every change is committed against the version it was read at.
 * The memory implementation is in `repo.ts`.
 */

/** A loaded account: the engine's working set and the version to commit against. */
export type LoadedAccount = { workingSet: PaperEngineWorkingSet; version: number };

/**
 * One engine change as the working set before it (null for an account's first commit) and after
 * it. A store keeps what is new or different in `after`; the Postgres store diffs the two.
 */
export type AccountChange = {
  before: PaperEngineWorkingSet | null;
  after: PaperEngineWorkingSet;
  /**
   * `after` is a whole account (every order and ledger entry) taking the place of the stored one:
   * its orders and their history replace the stored ones, and its ledger entries are added where
   * the ledger does not have them yet (the ledger is append-only).
   */
  replace?: boolean;
};

/**
 * Whether the change clears the stored orders and their history: a replacing change, or an account
 * reset (T-155), which adds a `RESET` ledger entry (the engine's orders do not survive it either).
 * The ledger keeps every row and the audit log keeps every order action.
 */
export function clearsOrders({ before, after, replace = false }: AccountChange): boolean {
  if (replace) return true;
  const known = new Set(before?.ledger.entries.map((entry) => entry.id));
  return after.ledger.entries.some((entry) => entry.type === 'RESET' && !known.has(entry.id));
}

export type OrdersPageQuery = { status?: OrderStatus; cursor?: string; limit?: number };
export type LedgerPageQuery = { cursor?: string; limit?: number };

/** Thrown by `commit` when the account's version is not the one the caller read. */
export class AccountConflict extends Error {
  constructor(
    readonly userId: string,
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(
      `Account version moved: expected ${String(expectedVersion)}, found ${String(actualVersion)}`,
    );
    this.name = 'AccountConflict';
  }
}

export interface AccountStore {
  /** The account's working set and version, or null for a user without an account yet. */
  load(userId: string): Promise<LoadedAccount | null>;
  /**
   * Writes the change and the audit entries together and answers with the new version. Throws
   * `AccountConflict`, having written nothing, when the account is not at `expectedVersion`
   * (0 for an account that does not exist yet).
   */
  commit(
    userId: string,
    change: AccountChange,
    expectedVersion: number,
    auditEntries: readonly NewAuditRecord[],
  ): Promise<number>;
  /** One page of the user's orders, newest first; null when the cursor is not one of them. */
  ordersPage(userId: string, query?: OrdersPageQuery): Promise<OrdersPage | null>;
  /** The order's changes, oldest first; null when the user has no such order. */
  orderHistory(userId: string, orderId: string): Promise<OrderHistoryResponse | null>;
  /** One page of the user's funds ledger, newest first; null when the cursor is not an entry. */
  ledgerPage(userId: string, query?: LedgerPageQuery): Promise<LedgerPage | null>;
  /**
   * Users with an AMO or OPEN order or an active trailing stop (loaded at boot so resting orders
   * still fill and stops keep stepping on ticks alone, NSTOCK-0368).
   */
  liveAccountIds(): Promise<string[]>;
  /** Users with an order change or a ledger entry on the IST trade date `YYYY-MM-DD`. */
  accountsTouchedOn(tradeDate: string): Promise<string[]>;
  /** Users holding stock: at least one delivery holding (the P&L snapshot job, T-209). */
  accountsWithHoldings(): Promise<string[]>;
  /** Tests only: forget every account. */
  reset(): Promise<void>;
}
