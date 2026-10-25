/**
 * Storage seam for the end-of-day P&L snapshots (`pnl_snapshots`, spec backend-core §4.3), written
 * by the 15:45 `pnl.snapshot` job (T-209). One row per user and IST trade date; amounts are
 * integer paise. The Postgres implementation is in `pgRepo.ts`.
 */
export type PnlSnapshot = {
  userId: string;
  /** The IST trade date, `YYYY-MM-DD`. */
  tradeDate: string;
  invested: number;
  currentValue: number;
  dayPnl: number;
  realisedPnl: number;
  totalPnl: number;
  /** When the snapshot was taken (UTC). */
  createdAt: Date;
};

export interface PnlSnapshotRepo {
  /** Writes the user's snapshot for its trade date, replacing one already there. */
  upsert(snapshot: PnlSnapshot): Promise<void>;
  /** The user's snapshot for the trade date, or null. */
  find(userId: string, tradeDate: string): Promise<PnlSnapshot | null>;
  /** Tests only: forget every snapshot. */
  reset(): Promise<void>;
}

const keyOf = (userId: string, tradeDate: string) => `${userId}\u0000${tradeDate}`;

export function createMemoryPnlSnapshotRepo(): PnlSnapshotRepo {
  const snapshots = new Map<string, PnlSnapshot>();
  return {
    upsert: (snapshot) => {
      snapshots.set(keyOf(snapshot.userId, snapshot.tradeDate), structuredClone(snapshot));
      return Promise.resolve();
    },
    find: (userId, tradeDate) => {
      const found = snapshots.get(keyOf(userId, tradeDate));
      return Promise.resolve(found ? structuredClone(found) : null);
    },
    reset: () => {
      snapshots.clear();
      return Promise.resolve();
    },
  };
}
