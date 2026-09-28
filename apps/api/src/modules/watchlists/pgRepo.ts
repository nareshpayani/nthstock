import type { Exchange } from '@nthstock/contracts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database, Tx } from '../../db/client.js';
import { users } from '../../db/schema/users.js';
import { watchlistItems, watchlists } from '../../db/schema/watchlists.js';
import type { WatchlistsRepo } from './repo.js';
import type { WatchlistItemRecord, WatchlistRecord } from './schema.js';

type ListRow = typeof watchlists.$inferSelect;
type ItemRow = typeof watchlistItems.$inferSelect;

export type PgWatchlistsRepoOptions = { database: Database };

/** Thrown when `update` names a user that is not stored: lists belong to a users row. */
export class UnknownWatchlistUserError extends Error {
  constructor() {
    super('Watchlists need a stored user');
    this.name = 'UnknownWatchlistUserError';
  }
}

const sameTime = (a: Date, b: Date) => a.getTime() === b.getTime();

const listRow = (userId: string, list: WatchlistRecord, position: number): ListRow => ({
  id: list.id,
  userId,
  name: list.name,
  position,
  createdAt: list.createdAt,
  updatedAt: list.updatedAt,
});

const itemRow = (watchlistId: string, item: WatchlistItemRecord, position: number): ItemRow => ({
  watchlistId,
  token: item.token,
  symbol: item.symbol,
  exchange: item.exchange,
  name: item.name,
  position,
  addedAt: item.addedAt,
});

const sameListRow = (a: ListRow, b: ListRow) =>
  a.name === b.name &&
  a.position === b.position &&
  sameTime(a.createdAt, b.createdAt) &&
  sameTime(a.updatedAt, b.updatedAt);

const sameItemRow = (a: ItemRow, b: ItemRow) =>
  a.symbol === b.symbol &&
  a.exchange === b.exchange &&
  a.name === b.name &&
  a.position === b.position &&
  sameTime(a.addedAt, b.addedAt);

/**
 * Watchlists in Postgres (T-197, spec backend-core §4.2 and §5.2). `update` is one transaction:
 * it locks the user's row (`SELECT … FOR UPDATE`), so concurrent changes to one user's lists run
 * one after the other and the service's 10-list and 50-stock limits hold; reads the lists; runs
 * `change`; and writes only the rows that differ. Positions are unique per user and per list as
 * deferred constraints, so a reorder can update rows in any order.
 */
export function createPgWatchlistsRepo({ database }: PgWatchlistsRepoOptions): WatchlistsRepo {
  async function read(tx: Tx, userId: string) {
    const lists = await tx
      .select()
      .from(watchlists)
      .where(eq(watchlists.userId, userId))
      .orderBy(asc(watchlists.position));
    const items =
      lists.length === 0
        ? []
        : await tx
            .select()
            .from(watchlistItems)
            .where(
              inArray(
                watchlistItems.watchlistId,
                lists.map((list) => list.id),
              ),
            )
            .orderBy(asc(watchlistItems.watchlistId), asc(watchlistItems.position));
    return { lists, items };
  }

  function toRecords(lists: ListRow[], items: ItemRow[]): WatchlistRecord[] {
    const byList = new Map<string, WatchlistItemRecord[]>(lists.map((list) => [list.id, []]));
    for (const item of items) {
      byList.get(item.watchlistId)?.push({
        token: item.token,
        symbol: item.symbol,
        // The table's CHECK holds this to EXCHANGES.
        exchange: item.exchange as Exchange,
        name: item.name,
        addedAt: item.addedAt,
      });
    }
    return lists.map((list) => ({
      id: list.id,
      userId: list.userId,
      name: list.name,
      items: byList.get(list.id) ?? [],
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
    }));
  }

  /**
   * Writes the difference between the stored rows and `next`. Deletes go first, so a name or a
   * position freed by a deleted list or stock can be taken in the same change. Positions are
   * checked at commit; names are not (an expression index cannot be deferred), so one change
   * cannot swap two lists' names. The service changes at most one name per change.
   */
  async function write(
    tx: Tx,
    userId: string,
    before: { lists: ListRow[]; items: ItemRow[] },
    next: WatchlistRecord[],
  ) {
    const nextIds = new Set(next.map((list) => list.id));
    const gone = before.lists.filter((list) => !nextIds.has(list.id)).map((list) => list.id);
    if (gone.length > 0) {
      await tx
        .delete(watchlists)
        .where(and(eq(watchlists.userId, userId), inArray(watchlists.id, gone)));
    }

    const storedLists = new Map(before.lists.map((row) => [row.id, row]));
    const storedItems = new Map<string, Map<number, ItemRow>>();
    for (const item of before.items) {
      const forList = storedItems.get(item.watchlistId) ?? new Map<number, ItemRow>();
      forList.set(item.token, item);
      storedItems.set(item.watchlistId, forList);
    }

    const newLists: ListRow[] = [];
    for (const [position, list] of next.entries()) {
      const row = listRow(userId, list, position);
      const stored = storedLists.get(list.id);
      if (!stored) newLists.push(row);
      else if (!sameListRow(stored, row)) {
        await tx
          .update(watchlists)
          .set({
            name: row.name,
            position: row.position,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          })
          .where(and(eq(watchlists.id, row.id), eq(watchlists.userId, userId)));
      }
    }
    // A list id another user holds fails here on the primary key, so nothing is written.
    if (newLists.length > 0) await tx.insert(watchlists).values(newLists);

    for (const list of next) {
      const stored = storedItems.get(list.id) ?? new Map<number, ItemRow>();
      const rows = list.items.map((item, position) => itemRow(list.id, item, position));
      const keep = new Set(
        rows.flatMap((row) => {
          const old = stored.get(row.token);
          return old && sameItemRow(old, row) ? [row.token] : [];
        }),
      );
      // Removed and changed stocks are deleted, then changed and new ones inserted: two
      // statements per list, however many stocks a reorder moves.
      const replaced = [...stored.keys()].filter((token) => !keep.has(token));
      if (replaced.length > 0) {
        await tx
          .delete(watchlistItems)
          .where(
            and(eq(watchlistItems.watchlistId, list.id), inArray(watchlistItems.token, replaced)),
          );
      }
      const inserts = rows.filter((row) => !keep.has(row.token));
      if (inserts.length > 0) await tx.insert(watchlistItems).values(inserts);
    }
  }

  return {
    update: (userId, change) =>
      database.transaction(async (tx) => {
        const locked = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');
        if (locked.length === 0) throw new UnknownWatchlistUserError();
        const before = await read(tx, userId);
        const { lists, result } = change(
          before.lists.length === 0 ? null : toRecords(before.lists, before.items),
        );
        await write(tx, userId, before, lists);
        return result;
      }),

    reset: () =>
      Promise.reject(
        new Error(
          'The Postgres watchlists repo does not reset: tests truncate its tables as the owner ' +
            '(TestPostgres.truncate).',
        ),
      ),
  };
}
