import { randomUUID } from 'node:crypto';
import type {
  AccountDeltaEvent,
  AccountState,
  FundsSummary,
  Holding,
  LedgerPage,
  MatcherFill,
  InstrumentToken,
  ModifyOrderRequest,
  Order,
  OrderHistoryResponse,
  OrdersPage,
  OrdersQuery,
  ModifyTrailingStopRequest,
  PlaceOrderRequest,
  PlaceTrailingStopRequest,
  PortfolioSummary,
  Position,
  PositionKey,
  TrailingStop,
} from '@nthstock/contracts';
import {
  PaperDesk,
  orderApiError,
  trailingStopApiError,
  type DeskMarket,
  type OrderActionResult,
  type TrailingStopActionResult,
  type PaperEngine,
  type PaperEngineSnapshot,
  type PaperEngineWorkingSet,
} from '@nthstock/paperEngine';
import type { Clock } from '@nthstock/utils';
import { ApiHttpError } from '../../http/apiError.js';
import type { AuditAction, AuditRepo, NewAuditRecord } from '../audit/index.js';
import { AccountConflict, type AccountStore } from './accountStore.js';

export type OrderServiceDeps = {
  clock: Clock;
  /** The process's market data adapter: symbol master, quotes, stats and ticks. */
  market: DeskMarket;
  audit: AuditRepo;
  /** The record behind each user's engine (spec backend-core §5.3); the engines are a cache. */
  accounts: AccountStore;
  /**
   * Where an audit write that no request waits for (fills, fund movements) reports a failure;
   * default: a line on stderr. A request's own entry fails the request instead.
   */
  onAuditError?: (error: Error) => void;
  /** Ids for orders and ledger entries; default `pe_<uuid>`. */
  newId?: () => string;
};

/**
 * A committed order change. `version` is the user's account version after the commit that made
 * it: it only grows, so the matcher can drop a command older than the one it holds (NSTOCK-0365).
 * One commit can announce several updates of an order (an AMO released and filled in one sweep)
 * at the same version; `last` is false for all but the final one of that order in the commit.
 */
export type OrderUpdateListener = (
  userId: string,
  order: Order,
  version: number,
  last?: boolean,
) => void;

/**
 * A committed trailing stop change, at the account version after its commit (the matcher's
 * `STOP_ADD` / `STOP_CANCEL`, NSTOCK-0368). Only a stop's final state in the commit is announced.
 */
export type TrailingStopUpdateListener = (
  userId: string,
  stop: TrailingStop,
  version: number,
) => void;

/** One committed account change, for the Redis publisher (NSTOCK-0368). */
export type AccountDelta = AccountDeltaEvent['delta'];
export type AccountDeltaListener = (userId: string, delta: AccountDelta) => void;

export type OrderService = ReturnType<typeof createOrderService>;

const orderGone = (): never => {
  throw new ApiHttpError(404, 'NOT_FOUND', 'This order was not found.');
};

const accountMoved = (): never => {
  throw new ApiHttpError(
    409,
    'CONFLICT',
    'Your account changed while this was saved. Check your orders and try again.',
  );
};

/**
 * A working set as a comparable string, without `syncedTo`: every read syncs the engine to now,
 * and only a change in the account itself is worth a commit.
 */
const stateKey = (workingSet: PaperEngineWorkingSet): string =>
  JSON.stringify({ ...workingSet, syncedTo: null });

/** What the service knows about one user's account beside the engine on the desk. */
type AccountCache = {
  /** The store version the engine's state was committed at (0: no account yet). */
  version: number;
  /** The working set last committed (or loaded), the `before` of the next change. */
  committed: PaperEngineWorkingSet | null;
  /** `committed` as `sameState` compares it, so a read that changed nothing writes nothing. */
  committedKey: string | null;
  /** Audit entries for the change being made, committed with it. */
  pending: NewAuditRecord[];
  /** Order updates for the change being made, announced once it is committed. */
  updates: Order[];
  /** Trailing-stop updates for the change being made, announced with the order updates. */
  stopUpdates: TrailingStop[];
  /** A commit lost to another writer since the last `settle`: the engine was reloaded. */
  conflicted: boolean;
  /** A commit failed for another reason: reload before the next use. */
  stale: boolean;
  /** The entry that closes the change being made (the funds reset's), from the funds after it. */
  closing: ((funds: FundsSummary) => NewAuditRecord) | null;
};

/**
 * The place request as the audit log keeps it: the instrument token as `instrument`, because a
 * detail key containing "token" is refused (spec backend-core §8 deny list).
 */
function auditedPlaceRequest({ token, ...rest }: PlaceOrderRequest | PlaceTrailingStopRequest) {
  return { ...rest, instrument: token };
}

/** The latest copy of each entity, in the order each first changed. */
function latestById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

/**
 * The orders module (T-131): paper orders on the `PaperDesk` (one engine per user, fed by the
 * adapter's ticks), with every order action and every order state change written to the audit
 * log. A refused action answers with `orderApiError`, the same mapping the MSW mock uses.
 */
export function createOrderService({
  clock,
  market,
  audit,
  accounts,
  onAuditError = (error) => {
    process.stderr.write(`audit write failed: ${error.message}\n`);
  },
  newId = () => `pe_${randomUUID().replaceAll('-', '')}`,
}: OrderServiceDeps) {
  const listeners = new Set<OrderUpdateListener>();
  const deltaListeners = new Set<AccountDeltaListener>();
  const stopListeners = new Set<TrailingStopUpdateListener>();
  /** How many of each user's ledger entries are in the audit log already. */
  const auditedLedger = new Map<string, number>();
  const cache = new Map<string, AccountCache>();
  const loading = new Map<string, Promise<void>>();

  const reportError = (error: unknown) => {
    onAuditError(error instanceof Error ? error : new Error(String(error)));
  };

  /**
   * Each user's writes (commits and audit entries) go out one after another, in the order the
   * desk reported the changes, so the store and the log follow what happened even though the
   * desk's callbacks are synchronous. Users do not wait for each other. A queue is dropped once it
   * drains.
   */
  const queues = new Map<string, Promise<void>>();
  function enqueue(userId: string, work: () => Promise<void>): Promise<void> {
    const next = (queues.get(userId) ?? Promise.resolve()).then(work);
    const settled = next.catch(reportError);
    queues.set(userId, settled);
    void settled.then(() => {
      if (queues.get(userId) === settled) queues.delete(userId);
    });
    return next;
  }

  function record(userId: string, entries: readonly NewAuditRecord[]): Promise<void> {
    return enqueue(userId, async () => {
      await audit.appendMany(entries);
    });
  }

  /** Every funds ledger entry not yet audited: each fund movement gets its own entry. */
  function fundMovements(userId: string, engine: PaperEngine): NewAuditRecord[] {
    const from = auditedLedger.get(userId) ?? 0;
    if (engine.ledger.size <= from) return [];
    auditedLedger.set(userId, engine.ledger.size);
    return engine.ledger.entriesFrom(from).map((entry): NewAuditRecord => ({
      actor: { type: 'system' },
      userId,
      action: 'FUNDS_MOVEMENT',
      orderId: entry.orderId,
      outcome: 'OK',
      detail: {
        entryId: entry.id,
        type: entry.type,
        amount: entry.amount,
        balanceAfter: entry.balanceAfter,
      },
    }));
  }

  /** Puts the store's account on the desk (or a new, empty one) and remembers its version. */
  async function hydrate(userId: string): Promise<void> {
    const loaded = await accounts.load(userId);
    if (loaded) await desk.restore(userId, loaded.workingSet);
    else desk.forget(userId);
    // A loaded ledger is the store's: its movements were audited when they were committed. A new
    // account's opening credit is still to be audited, with its first commit.
    auditedLedger.set(userId, loaded ? desk.engineOf(userId).ledger.size : 0);
    cache.set(userId, {
      version: loaded?.version ?? 0,
      committed: loaded?.workingSet ?? null,
      committedKey: loaded ? stateKey(loaded.workingSet) : null,
      pending: [],
      updates: [],
      stopUpdates: [],
      conflicted: false,
      stale: false,
      closing: null,
    });
  }

  /** Loads the user's account the first time it is used (and again after a failed commit). */
  function ensure(userId: string): Promise<void> {
    const known = cache.get(userId);
    if (known && !known.stale) return Promise.resolve();
    let pending = loading.get(userId);
    if (!pending) {
      pending = enqueue(userId, () => hydrate(userId)).finally(() => loading.delete(userId));
      loading.set(userId, pending);
    }
    return pending;
  }

  /**
   * Commits the engine's change (its working set against the last committed one) with the audit
   * entries and order updates it produced, then announces the updates. A commit that lost to
   * another writer reloads the account; any other failure marks it stale for the next use.
   */
  function persist(userId: string, engine: PaperEngine, { replace = false } = {}): void {
    const account = cache.get(userId);
    if (!account) return;
    const after = engine.workingSet({ whole: replace });
    const key = stateKey(after);
    if (!replace && key === account.committedKey && account.pending.length === 0) return;
    account.committedKey = key;
    const entries = [...account.pending.splice(0), ...fundMovements(userId, engine)];
    if (account.closing) entries.push(account.closing(engine.fundsSummary()));
    account.closing = null;
    const updates = account.updates.splice(0);
    const stopUpdates = account.stopUpdates.splice(0);
    void enqueue(userId, async () => {
      // A reload since this change replaced the engine: the change is gone with it.
      if (account.stale || desk.engineOf(userId) !== engine) return;
      try {
        account.version = await accounts.commit(
          userId,
          { before: account.committed, after, ...(replace ? { replace } : {}) },
          account.version,
          entries,
        );
        account.committed = after;
      } catch (error) {
        if (!(error instanceof AccountConflict)) {
          account.stale = true;
          throw error;
        }
        await hydrate(userId);
        const reloaded = cache.get(userId);
        if (reloaded) reloaded.conflicted = true;
        return;
      }
      const { version } = account;
      for (const [at, order] of updates.entries()) {
        const last = !updates.slice(at + 1).some((later) => later.id === order.id);
        for (const listener of [...listeners]) listener(userId, order, version, last);
      }
      const stops = latestById(stopUpdates);
      for (const stop of stops)
        for (const listener of [...stopListeners]) {
          // A failing listener must not stop the others, nor the delta below.
          try {
            listener(userId, stop, version);
          } catch (error) {
            reportError(error);
          }
        }
      await announceDelta(userId, engine, latestById(updates), stops);
    }).catch(() => undefined);
  }

  /**
   * Tells the delta listeners about a committed change (NSTOCK-0368): its orders and trailing
   * stops at the newest `seq` they carry, with the positions and funds after it. A change with
   * neither (a ledger-only sync) or whose engine was replaced meanwhile announces nothing.
   */
  async function announceDelta(
    userId: string,
    engine: PaperEngine,
    orders: Order[],
    trailingStops: TrailingStop[],
  ): Promise<void> {
    if (deltaListeners.size === 0 || (orders.length === 0 && trailingStops.length === 0)) return;
    if (desk.engineOf(userId) !== engine) return;
    const seq = Math.max(
      ...orders.map((order) => order.seq ?? 0),
      ...trailingStops.map((s) => s.seq),
    );
    const positions = await desk.positions(userId);
    const delta: AccountDelta = {
      seq,
      at: clock.now().toISOString(),
      orders,
      positions,
      trailingStops,
      funds: desk.fundsSummary(userId),
    };
    for (const listener of [...deltaListeners]) {
      // One failing listener must not stop the others, nor fail the commit already made.
      try {
        listener(userId, delta);
      } catch (error) {
        reportError(error);
      }
    }
  }

  /**
   * Waits for the user's queued writes and answers whether one of them lost to another writer
   * (and clears that). A failed commit answers with its error.
   */
  async function settle(userId: string): Promise<boolean> {
    while (queues.has(userId)) await queues.get(userId);
    const account = cache.get(userId);
    if (account?.stale)
      throw new ApiHttpError(500, 'INTERNAL_ERROR', 'Your account could not be saved.');
    const conflicted = account?.conflicted ?? false;
    if (account) account.conflicted = false;
    return conflicted;
  }

  /** Whether the accounts with live orders are on the desk (see `hydrateLive`). */
  let liveLoaded = false;

  /**
   * Loads every account with a live (AMO or OPEN) order or an active trailing stop, so a resting
   * order placed before a restart fills on the tick that crosses it (spec backend-core §5.3) and
   * a stop keeps stepping on ticks alone (NSTOCK-0368). One account that fails to load is reported
   * and skipped; the next sweep tries it again.
   */
  async function hydrateLive(): Promise<void> {
    let failed = false;
    for (const userId of await accounts.liveAccountIds()) {
      try {
        await ensure(userId);
      } catch (error) {
        failed = true;
        reportError(
          new Error(
            `Account ${userId} did not load: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    }
    liveLoaded = !failed;
  }

  const desk = new PaperDesk({
    clock,
    market,
    newId,
    onTrailingStopUpdate: (userId, stop) => {
      const account = cache.get(userId);
      if (!account) return;
      account.pending.push({
        actor: { type: 'system' },
        userId,
        action: 'TRAILING_STOP_UPDATE',
        orderId: stop.exitOrderId,
        outcome: 'OK',
        detail: {
          trailingStopId: stop.id,
          status: stop.status,
          stopPrice: stop.stopPrice,
          protectedQty: stop.protectedQty,
          reason: stop.statusReason,
        },
      });
      account.stopUpdates.push(stop);
    },
    onOrderUpdate: (userId, order) => {
      const account = cache.get(userId);
      if (!account) return;
      account.pending.push({
        actor: { type: 'system' },
        userId,
        action: 'ORDER_UPDATE',
        orderId: order.id,
        outcome: 'OK',
        detail: { status: order.status, filledQty: order.filledQty, reason: order.statusReason },
      });
      account.updates.push(order);
    },
    onChange: (userId, engine) => {
      persist(userId, engine);
    },
  });

  /**
   * Runs a user's order action on their engine, commits it, audits it, and answers with the order
   * or the ApiError. When another writer changed the account first, the account is reloaded and
   * the action runs once more against it; losing twice answers 409 CONFLICT.
   */
  async function act(
    userId: string,
    action: AuditAction,
    target: { orderId: string | null; request: unknown },
    run: () => Promise<OrderActionResult>,
  ): Promise<Order> {
    await ensure(userId);
    let result = await run();
    if (await settle(userId)) {
      result = await run();
      if (await settle(userId)) accountMoved();
    }
    const order: Order | null = result.order;
    // Answers only once the entry (and every change queued before it) is written.
    await record(userId, [
      {
        actor: { type: 'user', userId },
        userId,
        action,
        orderId: order?.id ?? target.orderId,
        outcome: result.ok ? 'OK' : 'REFUSED',
        detail: {
          request: target.request,
          ...(order ? { status: order.status } : {}),
          ...(result.ok ? {} : { reason: result.code }),
        },
      },
    ]);
    if (result.ok) return result.order;
    const error = orderApiError(result);
    throw new ApiHttpError(error.status, error.code, error.message, error.details);
  }

  /**
   * `act` for a trailing-stop action (NSTOCK-0368): the same commit, retry and audit rules, with
   * the stop id in the entry's detail.
   */
  async function actOnStop(
    userId: string,
    action: AuditAction,
    target: { trailingStopId: string | null; request: unknown },
    run: () => Promise<TrailingStopActionResult>,
  ): Promise<TrailingStop> {
    await ensure(userId);
    let result = await run();
    if (await settle(userId)) {
      result = await run();
      if (await settle(userId)) accountMoved();
    }
    const stop: TrailingStop | null = result.trailingStop;
    await record(userId, [
      {
        actor: { type: 'user', userId },
        userId,
        action,
        orderId: null,
        outcome: result.ok ? 'OK' : 'REFUSED',
        detail: {
          trailingStopId: stop?.id ?? target.trailingStopId,
          request: target.request,
          ...(stop ? { status: stop.status } : {}),
          ...(result.ok ? {} : { reason: result.code }),
        },
      },
    ]);
    if (result.ok) return result.trailingStop;
    const error = trailingStopApiError(result);
    throw new ApiHttpError(error.status, error.code, error.message, error.details);
  }

  /** Brings the user's engine up to date and waits until that is committed, for a read. */
  async function current(userId: string): Promise<void> {
    await ensure(userId);
    // Any read syncs the engine (session events, fills since the last tick) and commits that.
    desk.fundsSummary(userId);
    await settle(userId);
  }

  /** Runs a read on the user's engine once it is loaded, and waits for what the read committed. */
  async function read<T>(userId: string, view: () => T | Promise<T>): Promise<T> {
    await ensure(userId);
    const value = await view();
    await settle(userId);
    return value;
  }

  return {
    place: (userId: string, request: PlaceOrderRequest) =>
      act(userId, 'ORDER_PLACE', { orderId: null, request: auditedPlaceRequest(request) }, () =>
        desk.place(userId, request),
      ),

    modify: (userId: string, id: string, request: ModifyOrderRequest) =>
      act(userId, 'ORDER_MODIFY', { orderId: id, request }, () => desk.modify(userId, id, request)),

    cancel: (userId: string, id: string) =>
      act(userId, 'ORDER_CANCEL', { orderId: id, request: null }, () => desk.cancel(userId, id)),

    /** Today's trailing stops, newest first (NSTOCK-0368, SPEC-TFC-1 §10.6). */
    trailingStops: (userId: string): Promise<TrailingStop[]> =>
      read(userId, () => desk.trailingStops(userId)),

    placeTrailingStop: (userId: string, request: PlaceTrailingStopRequest) =>
      actOnStop(
        userId,
        'TRAILING_STOP_PLACE',
        { trailingStopId: null, request: auditedPlaceRequest(request) },
        () => desk.placeTrailingStop(userId, request),
      ),

    modifyTrailingStop: (userId: string, id: string, request: ModifyTrailingStopRequest) =>
      actOnStop(userId, 'TRAILING_STOP_MODIFY', { trailingStopId: id, request }, () =>
        desk.modifyTrailingStop(userId, id, request),
      ),

    cancelTrailingStop: (userId: string, id: string) =>
      actOnStop(userId, 'TRAILING_STOP_CANCEL', { trailingStopId: id, request: null }, () =>
        desk.cancelTrailingStop(userId, id),
      ),

    /**
     * Closes a position in one step (SPEC-TFC-1 §6.4): cancels its trailing stop and working
     * orders and answers with the reduce-only market exit.
     */
    closePosition: (userId: string, { token, product }: PositionKey) =>
      act(
        userId,
        'POSITION_CLOSE',
        { orderId: null, request: { instrument: token, product } },
        () => desk.closePosition(userId, token, product),
      ),

    /** The trading state at one `seq` (ADR 0012), which the web app's trading store loads. */
    accountState: (userId: string): Promise<AccountState> =>
      read(userId, () => desk.accountState(userId)),

    /** The order; older orders than the engine keeps (before today) come from the store. */
    async get(userId: string, id: string): Promise<Order> {
      const order = await read(userId, () => desk.getOrder(userId, id));
      if (order) return order;
      for (let cursor: string | undefined; ;) {
        const page = await accounts.ordersPage(userId, {
          ...(cursor ? { cursor } : {}),
          limit: 100,
        });
        const found = page?.items.find((item) => item.id === id);
        if (found) return found;
        if (!page?.nextCursor) return orderGone();
        cursor = page.nextCursor;
      }
    },

    /** The order's changes, oldest first (T-146); 404 for another user's order. */
    async history(userId: string, id: string): Promise<OrderHistoryResponse> {
      await current(userId);
      return (await accounts.orderHistory(userId, id)) ?? orderGone();
    },

    async list(userId: string, query: OrdersQuery): Promise<OrdersPage> {
      await current(userId);
      const page = await accounts.ordersPage(userId, {
        ...(query.status ? { status: query.status } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
      });
      if (!page) throw new ApiHttpError(400, 'VALIDATION_ERROR', 'Invalid cursor');
      // The store keeps no `seq` (ADR 0012); the engine's copy of a current order carries it.
      return {
        ...page,
        items: page.items.map((order) => desk.getOrder(userId, order.id) ?? order),
      };
    },

    funds: (userId: string): Promise<FundsSummary> => read(userId, () => desk.fundsSummary(userId)),

    /** One page of the user's funds ledger, newest first (T-155); 400 for an unknown cursor. */
    async ledger(
      userId: string,
      query: { cursor?: string | undefined; limit?: number | undefined },
    ): Promise<LedgerPage> {
      await current(userId);
      const page = await accounts.ledgerPage(userId, {
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
      });
      if (!page) throw new ApiHttpError(400, 'VALIDATION_ERROR', 'Invalid cursor');
      return page;
    },

    /**
     * Resets the user's paper account (T-155, T-205): cancels open orders (each audited and pushed
     * as an order update), clears positions and holdings, restores the opening balance with a
     * `RESET` ledger entry (audited as a fund movement) and writes `audited`, the reset's own
     * entry, all in one commit: a failure leaves the stored account as it was. Losing to another
     * writer reloads and resets once more, then answers 409 CONFLICT.
     */
    async reset(
      userId: string,
      audited: (funds: FundsSummary) => NewAuditRecord,
    ): Promise<FundsSummary> {
      await ensure(userId);
      await settle(userId);
      const run = () => {
        const account = cache.get(userId);
        if (account) account.closing = audited;
        return desk.reset(userId);
      };
      let funds = run();
      if (await settle(userId)) {
        funds = run();
        if (await settle(userId)) accountMoved();
      }
      return funds;
    },

    /**
     * Queues the user's entries behind their audit writes already queued (the funds reset,
     * T-155, writes its entry after the cancellations and the RESET movement), and resolves once
     * they are written.
     */
    audit: (userId: string, entries: readonly NewAuditRecord[]): Promise<void> =>
      record(userId, entries),

    /** Settles once every audit write queued so far is written or reported (before shutdown). */
    flushAudit: async (): Promise<void> => {
      while (queues.size > 0) await Promise.all(queues.values());
    },

    /** Today's positions, marked to the LTP the engines see (read by the portfolio module). */
    positions: (userId: string): Promise<Position[]> => read(userId, () => desk.positions(userId)),

    /** Delivery holdings valued at the LTP against the previous close. */
    holdings: (userId: string): Promise<Holding[]> => read(userId, () => desk.holdings(userId)),

    /** Totals over the holdings rows, plus holdings and positions counts. */
    portfolioSummary: (userId: string): Promise<PortfolioSummary> =>
      read(userId, () => desk.portfolioSummary(userId)),

    hydrateLive,

    /** Every order change of every user (for the Redis publisher, T-133). */
    onOrderUpdate(listener: OrderUpdateListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Every committed account change of every user (for the Redis publisher, NSTOCK-0368). */
    onAccountDelta(listener: AccountDeltaListener): () => void {
      deltaListeners.add(listener);
      return () => {
        deltaListeners.delete(listener);
      };
    },

    /** Every committed trailing stop change of every user (for the matcher, NSTOCK-0368). */
    onTrailingStopUpdate(listener: TrailingStopUpdateListener): () => void {
      stopListeners.add(listener);
      return () => {
        stopListeners.delete(listener);
      };
    },

    /** Syncs every account, so session events run and are pushed without a request. */
    sweep: async (): Promise<void> => {
      // A boot that could not load the live accounts (the database was down) tries again here.
      if (!liveLoaded) await hydrateLive();
      await desk.sweep();
      // The session events it ran are announced once committed.
      while (queues.size > 0) await Promise.all(queues.values());
    },

    /**
     * Replaces the user's account with a saved one (the demo seed, T-174). Its ledger history is
     * taken as already audited: those movements happened before this process, not in it.
     */
    restore: async (userId: string, snapshot: PaperEngineSnapshot): Promise<void> => {
      await ensure(userId);
      await settle(userId);
      await desk.restore(userId, snapshot);
      const engine = desk.engineOf(userId);
      auditedLedger.set(userId, engine.ledger.size);
      persist(userId, engine, { replace: true });
      await settle(userId);
    },

    /**
     * A fill request from the matcher worker (ADR 0013, NSTOCK-0367): runs the user's engine at
     * the tick's price and time and commits what it fills, then announces it, like any tick. The
     * engine re-checks every order, so a request that arrives twice fills nothing twice and one
     * for an order modified or cancelled since fills only what still crosses. Losing to another
     * writer reloads and runs once more; a failed commit rejects, so the request is retried.
     */
    async applyMatcherFill(fill: MatcherFill): Promise<void> {
      await ensure(fill.userId);
      const run = () => desk.ingestFor([fill.userId], fill);
      await run();
      if (await settle(fill.userId)) {
        await run();
        // Losing twice: the newer writer's engine saw the same price, or the next tick will.
        await settle(fill.userId);
      }
    },

    /** A scripted tick for tests and scenarios (see `PaperDesk.pinPrice`). */
    pinPrice: (token: InstrumentToken, ltp: number) => {
      desk.pinPrice(token, ltp);
    },

    /** The LTP the engines see (tests). */
    ltp: (token: InstrumentToken) => desk.ltp(token),

    dispose: () => {
      listeners.clear();
      deltaListeners.clear();
      stopListeners.clear();
      desk.dispose();
    },
  };
}
