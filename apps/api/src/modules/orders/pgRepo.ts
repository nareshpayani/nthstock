import type {
  Exchange,
  LedgerEntry,
  LedgerEntryType,
  LedgerPage,
  Order,
  OrderHistoryEntry,
  OrderHistoryEvent,
  OrderHistoryResponse,
  OrderSide,
  OrderStatus,
  OrderType,
  OrdersPage,
  ProductType,
} from '@nthstock/contracts';
import { PAGE_LIMIT_DEFAULT } from '@nthstock/contracts';
import {
  PAPER_ENGINE_WORKING_SET_VERSION,
  type EngineHolding,
  type EnginePosition,
  type HoldingSale,
  type LedgerCarried,
  type PaperEngineWorkingSet,
} from '@nthstock/paperEngine';
import { fromIst, istDateKey, toIstParts } from '@nthstock/utils';
import { and, desc, eq, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import type { Database, Tx } from '../../db/client.js';
import { orderEvents, orders } from '../../db/orderTables.js';
import { orderTradeDate } from '../../db/orderTradeDate.js';
import {
  holdingSales,
  holdings,
  ledgerEntries,
  paperAccounts,
  positions,
} from '../../db/schema/paper.js';
import type { AuditRepo } from '../audit/index.js';
import {
  AccountConflict,
  type AccountChange,
  type AccountStore,
  type LedgerPageQuery,
  type LoadedAccount,
  type OrdersPageQuery,
} from './accountStore.js';

type OrderRow = typeof orders.$inferSelect;
type EventRow = typeof orderEvents.$inferSelect;
type LedgerRow = typeof ledgerEntries.$inferSelect;

const LIVE_STATUSES = ['AMO', 'OPEN'] satisfies OrderStatus[];
/** Rows per multi-row INSERT, well under Postgres' 65,535 bind parameters. */
const INSERT_CHUNK = 500;
/** `load` rereads when a commit lands between its reads; a few rounds always settle. */
const LOAD_ATTEMPTS = 5;

/** The instant the IST day of `at` started: what the engine's working set counts as "today". */
function istDayStart(at: Date): Date {
  const { year, month, day } = toIstParts(at);
  return fromIst(year, month, day, 0);
}

async function inChunks<T>(rows: readonly T[], write: (chunk: T[]) => Promise<unknown>) {
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    await write(rows.slice(start, start + INSERT_CHUNK));
  }
}

/** `excluded."column"`: the value an INSERT … ON CONFLICT DO UPDATE tried to write. */
const excluded = (column: string) => sql.raw(`excluded."${column}"`);

const toOrder = (row: OrderRow): Order => ({
  id: row.id,
  clientOrderId: row.clientOrderId,
  token: row.token,
  symbol: row.symbol,
  // The table's CHECK constraints hold these columns to the contract's lists.
  exchange: row.exchange as Exchange,
  side: row.side as OrderSide,
  type: row.type as OrderType,
  product: row.product as ProductType,
  qty: row.qty,
  price: row.price,
  filledQty: row.filledQty,
  avgFillPrice: row.avgFillPrice,
  status: row.status as OrderStatus,
  statusReason: row.statusReason,
  placedAt: row.placedAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const toHistoryEntry = (row: EventRow): OrderHistoryEntry => ({
  event: row.event as OrderHistoryEvent,
  status: row.status as OrderStatus,
  at: row.at.toISOString(),
  qty: row.qty,
  type: row.type as OrderType,
  price: row.price,
  fillPrice: row.fillPrice,
  note: row.note,
});

const toLedgerEntry = (row: LedgerRow): LedgerEntry => ({
  id: row.id,
  type: row.type as LedgerEntryType,
  amount: row.amount,
  balanceAfter: row.balanceAfter,
  orderId: row.orderId,
  description: row.description,
  createdAt: row.createdAt.toISOString(),
});

/** A page of `rows` fetched with one extra row: the extra row only says there is a next page. */
function pageOf<T extends { id: string }>(rows: readonly T[], limit: number) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? last.id : null };
}

export type PgAccountStoreOptions = { database: Database; audit: AuditRepo };

/**
 * The paper account store in Postgres (T-203, spec backend-core §4.3 and §5.3).
 *
 * `commit` is one transaction. It first takes the account row with `version = expected` (an INSERT
 * for the first commit), which also serialises commits of one account: a second commit waits for
 * the first and then finds the version moved, so exactly one of two racing commits wins and the
 * loser writes nothing. With the row held it diffs `change` into order upserts, new order events,
 * new ledger rows (numbered after the account's highest `seq`, so a user's sequence has no gaps),
 * the replaced position and holding-sale rows, changed holdings, and the audit entries.
 *
 * `load` rebuilds the engine's working set from those rows: today's and live orders with their
 * events, all holdings, and the ledger as a carried balance plus today's entries.
 */
export function createPgAccountStore({ database, audit }: PgAccountStoreOptions): AccountStore {
  /** Takes the account row at `expected` and moves it to the next version; AccountConflict if not. */
  async function claimVersion(
    tx: Tx,
    userId: string,
    after: PaperEngineWorkingSet,
    expected: number,
  ): Promise<number> {
    const syncedTo = new Date(after.syncedTo);
    const claimed =
      expected === 0
        ? await tx
            .insert(paperAccounts)
            .values({
              userId,
              openingBalance: after.openingBalance,
              version: 1,
              syncedTo,
              createdAt: syncedTo,
              updatedAt: syncedTo,
            })
            .onConflictDoNothing()
            .returning({ version: paperAccounts.version })
        : await tx
            .update(paperAccounts)
            .set({ version: sql`${paperAccounts.version} + 1`, syncedTo, updatedAt: syncedTo })
            .where(and(eq(paperAccounts.userId, userId), eq(paperAccounts.version, expected)))
            .returning({ version: paperAccounts.version });
    const [row] = claimed;
    if (row) return row.version;
    const [current] = await tx
      .select({ version: paperAccounts.version })
      .from(paperAccounts)
      .where(eq(paperAccounts.userId, userId));
    throw new AccountConflict(userId, expected, current?.version ?? 0);
  }

  async function writeOrders(tx: Tx, userId: string, { before, after }: AccountChange) {
    const stored = new Map(before?.orders.map((order) => [order.id, order]));
    const rejectCodes = new Map(after.rejectCodes);
    const changed = after.orders.filter((order) => !isDeepStrictEqual(stored.get(order.id), order));
    const rows = changed.map((order): OrderRow => ({
      id: order.id,
      tradeDate: orderTradeDate(new Date(order.placedAt)),
      userId,
      clientOrderId: order.clientOrderId,
      token: order.token,
      symbol: order.symbol,
      exchange: order.exchange,
      side: order.side,
      type: order.type,
      product: order.product,
      qty: order.qty,
      price: order.price,
      filledQty: order.filledQty,
      avgFillPrice: order.avgFillPrice,
      status: order.status,
      statusReason: order.statusReason,
      rejectCode: rejectCodes.get(order.id) ?? null,
      placedAt: new Date(order.placedAt),
      updatedAt: new Date(order.updatedAt),
    }));
    await inChunks(rows, async (chunk) => {
      const written = await tx
        .insert(orders)
        .values(chunk)
        .onConflictDoUpdate({
          target: [orders.tradeDate, orders.id],
          set: {
            type: excluded('type'),
            qty: excluded('qty'),
            price: excluded('price'),
            filledQty: excluded('filled_qty'),
            avgFillPrice: excluded('avg_fill_price'),
            status: excluded('status'),
            statusReason: excluded('status_reason'),
            rejectCode: excluded('reject_code'),
            updatedAt: excluded('updated_at'),
          },
          // Only the account's own row; an id another account holds writes nothing and fails below.
          setWhere: eq(orders.userId, userId),
        })
        .returning({ id: orders.id });
      if (written.length !== chunk.length) {
        throw new Error('An order id already belongs to another account');
      }
    });
  }

  async function writeOrderEvents(tx: Tx, userId: string, { before, after }: AccountChange) {
    const tradeDates = new Map(
      after.orders.map((order) => [order.id, orderTradeDate(new Date(order.placedAt))]),
    );
    const known = new Map(before?.history);
    const rows: (typeof orderEvents.$inferInsert)[] = [];
    for (const [orderId, entries] of after.history) {
      const tradeDate = tradeDates.get(orderId);
      if (tradeDate === undefined) throw new Error('Order history without its order');
      // History only grows: the events past the ones already stored are the new ones.
      for (const [index, entry] of entries.entries()) {
        if (index < (known.get(orderId)?.length ?? 0)) continue;
        rows.push({
          tradeDate,
          orderId,
          userId,
          seq: index + 1,
          event: entry.event,
          status: entry.status,
          at: new Date(entry.at),
          qty: entry.qty,
          type: entry.type,
          price: entry.price,
          fillPrice: entry.fillPrice,
          note: entry.note,
        });
      }
    }
    await inChunks(rows, (chunk) => tx.insert(orderEvents).values(chunk));
  }

  async function writeLedger(tx: Tx, userId: string, { before, after }: AccountChange) {
    const known = new Set(before?.ledger.entries.map((entry) => entry.id));
    const fresh = after.ledger.entries.filter((entry) => !known.has(entry.id));
    if (fresh.length === 0) return;
    // The account row is held, so no other commit of this user can number entries meanwhile.
    const [last] = await tx
      .select({ seq: ledgerEntries.seq })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.userId, userId))
      .orderBy(desc(ledgerEntries.seq))
      .limit(1);
    const first = (last?.seq ?? 0) + 1;
    await inChunks(
      fresh.map((entry, index) => ({
        id: entry.id,
        userId,
        seq: first + index,
        type: entry.type,
        amount: entry.amount,
        balanceAfter: entry.balanceAfter,
        orderId: entry.orderId,
        description: entry.description,
        createdAt: new Date(entry.createdAt),
      })),
      (chunk) => tx.insert(ledgerEntries).values(chunk),
    );
  }

  /** Today's positions and holding sales are small sets that change as a whole: replace them. */
  async function writeDay(tx: Tx, userId: string, { before, after }: AccountChange) {
    if (!isDeepStrictEqual(before?.positions ?? [], after.positions)) {
      await tx.delete(positions).where(eq(positions.userId, userId));
      const tradeDate = istDateKey(new Date(after.syncedTo));
      await inChunks(
        after.positions.map(({ token, symbol, exchange, product, book }) => ({
          userId,
          tradeDate,
          token,
          product,
          symbol,
          exchange,
          ...book,
        })),
        (chunk) => tx.insert(positions).values(chunk),
      );
    }
    if (!isDeepStrictEqual(before?.holdingSales ?? [], after.holdingSales)) {
      await tx.delete(holdingSales).where(eq(holdingSales.userId, userId));
      const tradeDate = istDateKey(new Date(after.syncedTo));
      await inChunks(
        after.holdingSales.map((sale) => ({ userId, tradeDate, ...sale })),
        (chunk) => tx.insert(holdingSales).values(chunk),
      );
    }
  }

  async function writeHoldings(tx: Tx, userId: string, { before, after }: AccountChange) {
    const stored = new Map(before?.holdings.map((holding) => [holding.token, holding.lot]));
    const kept = new Set(after.holdings.map((holding) => holding.token));
    const gone = [...stored.keys()].filter((token) => !kept.has(token));
    if (gone.length > 0) {
      await tx
        .delete(holdings)
        .where(and(eq(holdings.userId, userId), inArray(holdings.token, gone)));
    }
    const updatedAt = new Date(after.syncedTo);
    const changed = after.holdings.filter(
      (holding) => !isDeepStrictEqual(stored.get(holding.token), holding.lot),
    );
    await inChunks(
      changed.map(({ token, lot }) => ({
        userId,
        token,
        qty: lot.qty,
        investedValue: lot.investedValue,
        updatedAt,
      })),
      (chunk) =>
        tx
          .insert(holdings)
          .values(chunk)
          .onConflictDoUpdate({
            target: [holdings.userId, holdings.token],
            set: {
              qty: excluded('qty'),
              investedValue: excluded('invested_value'),
              updatedAt: excluded('updated_at'),
            },
          }),
    );
  }

  /** One consistent read of the account at `version`, or null when a commit landed meanwhile. */
  async function loadAt(userId: string, version: number): Promise<LoadedAccount | null> {
    return database.transaction(async (tx) => {
      const [account] = await tx
        .select()
        .from(paperAccounts)
        .where(eq(paperAccounts.userId, userId));
      if (account?.version !== version) return null;
      const since = istDayStart(account.syncedTo);

      const orderRows = await tx
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.userId, userId),
            or(inArray(orders.status, LIVE_STATUSES), gte(orders.updatedAt, since)),
          ),
        )
        .orderBy(orders.placedAt, orders.id);
      const orderIds = orderRows.map((row) => row.id);
      const eventRows =
        orderIds.length === 0
          ? []
          : await tx
              .select()
              .from(orderEvents)
              .where(
                and(
                  eq(orderEvents.userId, userId),
                  inArray(orderEvents.tradeDate, [...new Set(orderRows.map((r) => r.tradeDate))]),
                  inArray(orderEvents.orderId, orderIds),
                ),
              )
              .orderBy(orderEvents.orderId, orderEvents.seq);
      const eventsByOrder = new Map<string, OrderHistoryEntry[]>();
      for (const row of eventRows) {
        const entries = eventsByOrder.get(row.orderId) ?? [];
        entries.push(toHistoryEntry(row));
        eventsByOrder.set(row.orderId, entries);
      }

      const todays = await tx
        .select()
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.userId, userId), gte(ledgerEntries.createdAt, since)))
        .orderBy(ledgerEntries.seq);
      const [lastBefore] = await tx
        .select({ balanceAfter: ledgerEntries.balanceAfter })
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.userId, userId), lt(ledgerEntries.createdAt, since)))
        .orderBy(desc(ledgerEntries.seq))
        .limit(1);
      // Cash is blocked only for live orders, so their older block and release entries say how
      // much is still held (the engine's FundsLedger.workingSet does the same sum).
      const liveIds = orderRows.filter((row) => row.status === 'AMO' || row.status === 'OPEN');
      const blockRows =
        liveIds.length === 0
          ? []
          : await tx
              .select()
              .from(ledgerEntries)
              .where(
                and(
                  eq(ledgerEntries.userId, userId),
                  lt(ledgerEntries.createdAt, since),
                  inArray(ledgerEntries.type, ['ORDER_BLOCK', 'ORDER_RELEASE']),
                  inArray(
                    ledgerEntries.orderId,
                    liveIds.map((row) => row.id),
                  ),
                ),
              )
              .orderBy(ledgerEntries.seq);
      const blocks = new Map<string, number>();
      for (const row of blockRows) {
        if (row.orderId === null) continue;
        const held = (blocks.get(row.orderId) ?? 0) - row.amount;
        if (held === 0) blocks.delete(row.orderId);
        else blocks.set(row.orderId, held);
      }
      const carried: LedgerCarried = {
        available: lastBefore?.balanceAfter ?? 0,
        blocks: [...blocks],
      };

      // The engine keys these by token (and product), so their order carries no meaning; the
      // rows come back in key order.
      const positionRows = await tx
        .select()
        .from(positions)
        .where(eq(positions.userId, userId))
        .orderBy(positions.token, positions.product);
      const holdingRows = await tx
        .select()
        .from(holdings)
        .where(eq(holdings.userId, userId))
        .orderBy(holdings.token);
      const saleRows = await tx
        .select()
        .from(holdingSales)
        .where(eq(holdingSales.userId, userId))
        .orderBy(holdingSales.token);

      const workingSet: PaperEngineWorkingSet = {
        v: PAPER_ENGINE_WORKING_SET_VERSION,
        syncedTo: account.syncedTo.toISOString(),
        orders: orderRows.map(toOrder),
        rejectCodes: orderRows.flatMap((row) =>
          row.rejectCode === null
            ? []
            : [[row.id, row.rejectCode] as PaperEngineWorkingSet['rejectCodes'][number]],
        ),
        positions: positionRows.map((row): EnginePosition => ({
          token: row.token,
          symbol: row.symbol,
          exchange: row.exchange as Exchange,
          product: row.product as ProductType,
          book: {
            netQty: row.netQty,
            openCost: row.openCost,
            buyQty: row.buyQty,
            sellQty: row.sellQty,
            buyValue: row.buyValue,
            sellValue: row.sellValue,
            realisedPnl: row.realisedPnl,
          },
        })),
        holdings: holdingRows.map((row): EngineHolding => ({
          token: row.token,
          lot: { qty: row.qty, investedValue: row.investedValue },
        })),
        holdingSales: saleRows.map((row): HoldingSale => ({
          token: row.token,
          qty: row.qty,
          proceeds: row.proceeds,
          realisedPnl: row.realisedPnl,
        })),
        openingBalance: account.openingBalance,
        ledger: { carried, entries: todays.map(toLedgerEntry) },
        history: orderRows.flatMap((row) => {
          const entries = eventsByOrder.get(row.id);
          return entries ? [[row.id, entries] as [string, OrderHistoryEntry[]]] : [];
        }),
      };
      return { workingSet, version: account.version };
    });
  }

  return {
    async load(userId) {
      for (let attempt = 0; attempt < LOAD_ATTEMPTS; attempt += 1) {
        const [current] = await database.db
          .select({ version: paperAccounts.version })
          .from(paperAccounts)
          .where(eq(paperAccounts.userId, userId));
        if (!current) return null;
        // A commit between the version read and the reads in `loadAt` makes it answer null.
        const loaded = await loadAt(userId, current.version);
        if (loaded) return loaded;
      }
      throw new Error('The account kept changing while it was loaded');
    },

    commit: (userId, change, expectedVersion, auditEntries) =>
      database.transaction(async (tx) => {
        const version = await claimVersion(tx, userId, change.after, expectedVersion);
        await writeOrders(tx, userId, change);
        await writeOrderEvents(tx, userId, change);
        await writeLedger(tx, userId, change);
        await writeDay(tx, userId, change);
        await writeHoldings(tx, userId, change);
        // The audit entries commit or roll back with the change they record.
        await audit.appendMany(auditEntries, tx);
        return version;
      }),

    async ordersPage(userId, { status, cursor, limit = PAGE_LIMIT_DEFAULT }: OrdersPageQuery = {}) {
      const scope = and(eq(orders.userId, userId), status ? eq(orders.status, status) : undefined);
      let after: SQL | undefined;
      if (cursor !== undefined) {
        const [anchor] = await database.db
          .select({ placedAt: orders.placedAt, id: orders.id })
          .from(orders)
          .where(and(scope, eq(orders.id, cursor)));
        if (!anchor) return null;
        after = or(
          lt(orders.placedAt, anchor.placedAt),
          and(eq(orders.placedAt, anchor.placedAt), lt(orders.id, anchor.id)),
        );
      }
      const rows = await database.db
        .select()
        .from(orders)
        .where(and(scope, after))
        .orderBy(desc(orders.placedAt), desc(orders.id))
        .limit(limit + 1);
      return pageOf(rows.map(toOrder), limit) satisfies OrdersPage;
    },

    async orderHistory(userId, orderId) {
      const rows = await database.db
        .select()
        .from(orderEvents)
        .where(and(eq(orderEvents.userId, userId), eq(orderEvents.orderId, orderId)))
        .orderBy(orderEvents.seq);
      if (rows.length === 0) return null;
      return { orderId, items: rows.map(toHistoryEntry) } satisfies OrderHistoryResponse;
    },

    async ledgerPage(userId, { cursor, limit = PAGE_LIMIT_DEFAULT }: LedgerPageQuery = {}) {
      let after: SQL | undefined;
      if (cursor !== undefined) {
        const [anchor] = await database.db
          .select({ seq: ledgerEntries.seq })
          .from(ledgerEntries)
          .where(and(eq(ledgerEntries.userId, userId), eq(ledgerEntries.id, cursor)));
        if (!anchor) return null;
        after = lt(ledgerEntries.seq, anchor.seq);
      }
      const rows = await database.db
        .select()
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.userId, userId), after))
        .orderBy(desc(ledgerEntries.seq))
        .limit(limit + 1);
      return pageOf(rows.map(toLedgerEntry), limit) satisfies LedgerPage;
    },

    async liveAccountIds() {
      const rows = await database.db
        .selectDistinct({ userId: orders.userId })
        .from(orders)
        .where(inArray(orders.status, LIVE_STATUSES));
      return rows.map((row) => row.userId).sort();
    },

    async accountsTouchedOn(tradeDate) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tradeDate);
      if (!match) throw new RangeError(`Not a YYYY-MM-DD date: ${tradeDate}`);
      const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
      // The IST day as a UTC range; Date.UTC carries day + 1 into the next month.
      const start = fromIst(year, month, day, 0);
      const end = fromIst(year, month, day + 1, 0);
      const [fromOrders, fromLedger] = await Promise.all([
        database.db
          .selectDistinct({ userId: orders.userId })
          .from(orders)
          .where(and(gte(orders.updatedAt, start), lt(orders.updatedAt, end))),
        database.db
          .selectDistinct({ userId: ledgerEntries.userId })
          .from(ledgerEntries)
          .where(and(gte(ledgerEntries.createdAt, start), lt(ledgerEntries.createdAt, end))),
      ]);
      return [...new Set([...fromOrders, ...fromLedger].map((row) => row.userId))].sort();
    },

    reset: () =>
      Promise.reject(
        new Error(
          'The Postgres account store does not reset: the ledger is append-only for ' +
            'nthstock_app, and tests truncate its tables as the owner (TestPostgres.truncate).',
        ),
      ),
  };
}
