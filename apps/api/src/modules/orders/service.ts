import { randomUUID } from 'node:crypto';
import type {
  FundsSummary,
  Holding,
  LedgerPage,
  InstrumentToken,
  ModifyOrderRequest,
  Order,
  OrderHistoryResponse,
  OrdersPage,
  OrdersQuery,
  PlaceOrderRequest,
  PortfolioSummary,
  Position,
} from '@nthstock/contracts';
import {
  PaperDesk,
  orderApiError,
  type DeskMarket,
  type OrderActionResult,
  type PaperEngine,
  type PaperEngineSnapshot,
} from '@nthstock/paperEngine';
import type { Clock } from '@nthstock/utils';
import { ApiHttpError } from '../../http/apiError.js';
import type { AuditRepo } from '../audit/repo.js';
import type { AuditAction, NewAuditRecord } from '../audit/schema.js';
import type { OrdersRepo } from './repo.js';

export type OrderServiceDeps = {
  clock: Clock;
  /** The process's market data adapter: symbol master, quotes, stats and ticks. */
  market: DeskMarket;
  repo: OrdersRepo;
  audit: AuditRepo;
  /**
   * Where an audit write that no request waits for (fills, fund movements) reports a failure;
   * default: a line on stderr. A request's own entry fails the request instead.
   */
  onAuditError?: (error: Error) => void;
  /** Ids for orders and ledger entries; default `pe_<uuid>`. */
  newId?: () => string;
};

export type OrderUpdateListener = (userId: string, order: Order) => void;

export type OrderService = ReturnType<typeof createOrderService>;

const orderGone = (): never => {
  throw new ApiHttpError(404, 'NOT_FOUND', 'This order was not found.');
};

/**
 * The place request as the audit log keeps it: the instrument token as `instrument`, because a
 * detail key containing "token" is refused (spec backend-core §8 deny list).
 */
function auditedPlaceRequest({ token, ...rest }: PlaceOrderRequest) {
  return { ...rest, instrument: token };
}

/**
 * The orders module (T-131): paper orders on the `PaperDesk` (one engine per user, fed by the
 * adapter's ticks), with every order action and every order state change written to the audit
 * log. A refused action answers with `orderApiError`, the same mapping the MSW mock uses.
 */
export function createOrderService({
  clock,
  market,
  repo,
  audit,
  onAuditError = (error) => {
    process.stderr.write(`audit write failed: ${error.message}\n`);
  },
  newId = () => `pe_${randomUUID().replaceAll('-', '')}`,
}: OrderServiceDeps) {
  const listeners = new Set<OrderUpdateListener>();
  /** How many of each user's ledger entries are in the audit log already. */
  const auditedLedger = new Map<string, number>();

  /**
   * Each user's audit writes go out one after another, in the order the desk reported the
   * changes, so the log's ids follow what happened even though the desk's callbacks are
   * synchronous. Users do not wait for each other. A queue is dropped once it drains. Until the
   * account store commits entries with the change (T-203), this is the ordering guarantee.
   */
  const queues = new Map<string, Promise<void>>();
  function record(userId: string, entries: readonly NewAuditRecord[]): Promise<void> {
    const next = (queues.get(userId) ?? Promise.resolve()).then(async () => {
      await audit.appendMany(entries);
    });
    const settled = next.catch((error: unknown) => {
      onAuditError(error instanceof Error ? error : new Error(String(error)));
    });
    queues.set(userId, settled);
    void settled.then(() => {
      if (queues.get(userId) === settled) queues.delete(userId);
    });
    return next;
  }

  /** Writes every funds ledger entry not yet audited: each fund movement gets its own entry. */
  function auditFundMovements(userId: string, engine: PaperEngine): void {
    const from = auditedLedger.get(userId) ?? 0;
    if (engine.ledger.size <= from) return;
    const entries = engine.ledger.entriesFrom(from).map((entry): NewAuditRecord => ({
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
    auditedLedger.set(userId, engine.ledger.size);
    // Nobody waits on a fill's movements; a failure goes to onAuditError.
    void record(userId, entries).catch(() => undefined);
  }

  const desk = new PaperDesk({
    clock,
    market,
    newId,
    engines: repo,
    onOrderUpdate: (userId, order) => {
      void record(userId, [
        {
          actor: { type: 'system' },
          userId,
          action: 'ORDER_UPDATE',
          orderId: order.id,
          outcome: 'OK',
          detail: { status: order.status, filledQty: order.filledQty, reason: order.statusReason },
        },
      ]).catch(() => undefined);
      for (const listener of [...listeners]) listener(userId, order);
    },
    onChange: auditFundMovements,
  });

  /** Runs a user's order action, audits it, and answers with the order or the ApiError. */
  async function act(
    userId: string,
    action: AuditAction,
    target: { orderId: string | null; request: unknown },
    run: () => Promise<OrderActionResult>,
  ): Promise<Order> {
    const result = await run();
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

  return {
    place: (userId: string, request: PlaceOrderRequest) =>
      act(userId, 'ORDER_PLACE', { orderId: null, request: auditedPlaceRequest(request) }, () =>
        desk.place(userId, request),
      ),

    modify: (userId: string, id: string, request: ModifyOrderRequest) =>
      act(userId, 'ORDER_MODIFY', { orderId: id, request }, () => desk.modify(userId, id, request)),

    cancel: (userId: string, id: string) =>
      act(userId, 'ORDER_CANCEL', { orderId: id, request: null }, () => desk.cancel(userId, id)),

    get(userId: string, id: string): Order {
      return desk.getOrder(userId, id) ?? orderGone();
    },

    /** The order's changes, oldest first (T-146); 404 for another user's order. */
    history(userId: string, id: string): OrderHistoryResponse {
      return desk.orderHistory(userId, id) ?? orderGone();
    },

    list(userId: string, query: OrdersQuery): OrdersPage {
      const page = desk.ordersPage(userId, {
        ...(query.status ? { status: query.status } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
      });
      if (!page) throw new ApiHttpError(400, 'VALIDATION_ERROR', 'Invalid cursor');
      return page;
    },

    funds: (userId: string): FundsSummary => desk.fundsSummary(userId),

    /** One page of the user's funds ledger, newest first (T-155); 400 for an unknown cursor. */
    ledger(userId: string, query: { cursor?: string | undefined; limit?: number | undefined }) {
      const page: LedgerPage | null = desk.ledgerPage(userId, {
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
      });
      if (!page) throw new ApiHttpError(400, 'VALIDATION_ERROR', 'Invalid cursor');
      return page;
    },

    /**
     * Resets the user's paper account (T-155): cancels open orders (each audited and pushed as an
     * order update), clears positions and holdings, and restores the opening balance with a
     * `RESET` ledger entry (audited as a fund movement).
     */
    reset: (userId: string): FundsSummary => desk.reset(userId),

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
    positions: (userId: string): Promise<Position[]> => desk.positions(userId),

    /** Delivery holdings valued at the LTP against the previous close. */
    holdings: (userId: string): Promise<Holding[]> => desk.holdings(userId),

    /** Totals over the holdings rows, plus holdings and positions counts. */
    portfolioSummary: (userId: string): Promise<PortfolioSummary> => desk.portfolioSummary(userId),

    /** Every order change of every user (for the Redis publisher, T-133). */
    onOrderUpdate(listener: OrderUpdateListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Syncs every account, so session events run and are pushed without a request. */
    sweep: () => desk.sweep(),

    /**
     * Replaces the user's account with a saved one (the demo seed, T-174). Its ledger history is
     * taken as already audited: those movements happened before this process, not in it.
     */
    restore: async (userId: string, snapshot: PaperEngineSnapshot): Promise<void> => {
      await desk.restore(userId, snapshot);
      auditedLedger.set(userId, desk.engineOf(userId).ledger.size);
    },

    /** A scripted tick for tests and scenarios (see `PaperDesk.pinPrice`). */
    pinPrice: (token: InstrumentToken, ltp: number) => {
      desk.pinPrice(token, ltp);
    },

    /** The LTP the engines see (tests). */
    ltp: (token: InstrumentToken) => desk.ltp(token),

    dispose: () => {
      listeners.clear();
      desk.dispose();
    },
  };
}
