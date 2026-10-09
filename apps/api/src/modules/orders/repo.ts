import type { LedgerEntry, Order, OrderHistoryEntry, OrderStatus } from '@nthstock/contracts';
import { PAGE_LIMIT_DEFAULT } from '@nthstock/contracts';
import type { PaperEngineWorkingSet } from '@nthstock/paperEngine';
import { istDateKey } from '@nthstock/utils';
import type { AuditRepo } from '../audit/index.js';
import { AccountConflict, type AccountChange, type AccountStore } from './accountStore.js';

type StoredAccount = {
  version: number;
  workingSet: PaperEngineWorkingSet;
  /** Every order the account ever had, in the order first stored. */
  orders: Map<string, Order>;
  history: Map<string, OrderHistoryEntry[]>;
  ledger: LedgerEntry[];
  ledgerIds: Set<string>;
};

const LIVE: ReadonlySet<OrderStatus> = new Set(['AMO', 'OPEN']);

/**
 * The in-memory account store. Like the Postgres one it keeps more than the working set it hands
 * out: every order, order history and ledger entry ever committed, so the read queries see the
 * whole account. Audit entries go to `audit` with the commit.
 */
export function createMemoryAccountStore({ audit }: { audit: AuditRepo }): AccountStore {
  const accounts = new Map<string, StoredAccount>();

  /** The account with the change applied, leaving `current` untouched. */
  function applied(current: StoredAccount | undefined, { after }: AccountChange): StoredAccount {
    const orders = new Map(current?.orders);
    for (const order of after.orders) orders.set(order.id, structuredClone(order));
    const history = new Map(current?.history);
    for (const [id, entries] of after.history) history.set(id, structuredClone(entries));
    const ledger = [...(current?.ledger ?? [])];
    const ledgerIds = new Set(current?.ledgerIds);
    for (const entry of after.ledger.entries) {
      if (ledgerIds.has(entry.id)) continue;
      ledgerIds.add(entry.id);
      ledger.push(structuredClone(entry));
    }
    return {
      version: (current?.version ?? 0) + 1,
      workingSet: structuredClone(after),
      orders,
      history,
      ledger,
      ledgerIds,
    };
  }

  return {
    load: (userId) => {
      const account = accounts.get(userId);
      return Promise.resolve(
        account
          ? { workingSet: structuredClone(account.workingSet), version: account.version }
          : null,
      );
    },

    commit: async (userId, change, expectedVersion, auditEntries) => {
      const current = accounts.get(userId);
      const actual = current?.version ?? 0;
      if (actual !== expectedVersion) throw new AccountConflict(userId, expectedVersion, actual);
      const next = applied(current, change);
      // Taken synchronously with the check, so two commits at one version cannot both win.
      accounts.set(userId, next);
      try {
        await audit.appendMany(auditEntries);
      } catch (error) {
        // The change and its audit entries go together or not at all.
        if (accounts.get(userId) === next) {
          if (current) accounts.set(userId, current);
          else accounts.delete(userId);
        }
        throw error;
      }
      return next.version;
    },

    ordersPage: (userId, { status, cursor, limit } = {}) => {
      const all = [...(accounts.get(userId)?.orders.values() ?? [])].filter(
        (order) => status === undefined || order.status === status,
      );
      return Promise.resolve(newestFirstPage(all, cursor, limit));
    },

    orderHistory: (userId, orderId) => {
      const items = accounts.get(userId)?.history.get(orderId);
      return Promise.resolve(
        items && items.length > 0 ? { orderId, items: structuredClone(items) } : null,
      );
    },

    ledgerPage: (userId, { cursor, limit } = {}) =>
      Promise.resolve(newestFirstPage(accounts.get(userId)?.ledger ?? [], cursor, limit)),

    liveAccountIds: () =>
      Promise.resolve(
        [...accounts]
          .filter(([, account]) => [...account.orders.values()].some((o) => LIVE.has(o.status)))
          .map(([userId]) => userId),
      ),

    accountsTouchedOn: (tradeDate) => {
      const on = (iso: string) => istDateKey(new Date(iso)) === tradeDate;
      return Promise.resolve(
        [...accounts]
          .filter(
            ([, account]) =>
              [...account.orders.values()].some((o) => on(o.updatedAt)) ||
              account.ledger.some((entry) => on(entry.createdAt)),
          )
          .map(([userId]) => userId),
      );
    },

    reset: () => {
      accounts.clear();
      return Promise.resolve();
    },
  };
}

/** A cursor page of `all` (oldest first) read newest first; null for an unknown cursor. */
function newestFirstPage<T extends { id: string }>(
  all: readonly T[],
  cursor: string | undefined,
  limit: number = PAGE_LIMIT_DEFAULT,
): { items: T[]; nextCursor: string | null } | null {
  const newestFirst = [...all].reverse();
  let start = 0;
  if (cursor !== undefined) {
    const at = newestFirst.findIndex((item) => item.id === cursor);
    if (at < 0) return null;
    start = at + 1;
  }
  const items = newestFirst.slice(start, start + limit).map((item) => structuredClone(item));
  const last = items.at(-1);
  return { items, nextCursor: start + limit < newestFirst.length && last ? last.id : null };
}
