import type { WatchlistRecord } from './schema.js';

/** What a change to a user's lists returns: the lists to store, in order, and the caller's result. */
export type WatchlistsChange<T> = { lists: WatchlistRecord[]; result: T };

/**
 * Storage seam for watchlists (ADR 0004 §3). A user's lists are one aggregate (at most 10 lists of
 * 50 stocks), changed as a whole so the limits hold under concurrent requests. In-memory now; the
 * Postgres version runs `change` inside a transaction that locks the user's rows.
 */
export interface WatchlistsRepo {
  /**
   * Runs `change` on a copy of the user's lists in display order (`null` when the user has never
   * had any) as one atomic step, stores the lists it returns and resolves to its `result`. When
   * `change` throws, nothing is stored and the promise rejects with that error.
   */
  update<T>(
    userId: string,
    change: (lists: WatchlistRecord[] | null) => WatchlistsChange<T>,
  ): Promise<T>;
  /** Drops every list. Tests call it between cases. */
  reset(): Promise<void>;
}

const copyAll = (lists: readonly WatchlistRecord[]): WatchlistRecord[] =>
  structuredClone([...lists]);

export function createMemoryWatchlistsRepo(): WatchlistsRepo {
  const byUser = new Map<string, WatchlistRecord[]>();

  return {
    update: (userId, change) => {
      // `change` is synchronous, so nothing else can run between the read and the write.
      try {
        const current = byUser.get(userId);
        const { lists, result } = change(current ? copyAll(current) : null);
        byUser.set(userId, copyAll(lists));
        return Promise.resolve(result);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
    reset: () => {
      byUser.clear();
      return Promise.resolve();
    },
  };
}
