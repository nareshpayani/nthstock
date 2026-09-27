import { randomUUID } from 'node:crypto';
import type {
  FundsSummary,
  Holding,
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
} from '@nthstock/paperEngine';
import type { Clock } from '@nthstock/utils';
import { ApiHttpError } from '../../http/apiError.js';
import type { AuditRepo } from '../audit/repo.js';
import type { AuditAction } from '../audit/schema.js';
import type { OrdersRepo } from './repo.js';

export type OrderServiceDeps = {
  clock: Clock;
  /** The process's market data adapter: symbol master, quotes, stats and ticks. */
  market: DeskMarket;
  repo: OrdersRepo;
  audit: AuditRepo;
  /** Ids for orders and ledger entries; default `pe_<uuid>`. */
  newId?: () => string;
};

export type OrderUpdateListener = (userId: string, order: Order) => void;

export type OrderService = ReturnType<typeof createOrderService>;

const orderGone = (): never => {
  throw new ApiHttpError(404, 'NOT_FOUND', 'This order was not found.');
};

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
  newId = () => `pe_${randomUUID().replaceAll('-', '')}`,
}: OrderServiceDeps) {
  const listeners = new Set<OrderUpdateListener>();

  const desk = new PaperDesk({
    clock,
    market,
    newId,
    engines: repo,
    onOrderUpdate: (userId, order) => {
      audit.append({
        actor: { type: 'system' },
        userId,
        action: 'ORDER_UPDATE',
        orderId: order.id,
        outcome: 'OK',
        detail: { status: order.status, filledQty: order.filledQty, reason: order.statusReason },
      });
      for (const listener of [...listeners]) listener(userId, order);
    },
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
    audit.append({
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
    });
    if (result.ok) return result.order;
    const error = orderApiError(result);
    throw new ApiHttpError(error.status, error.code, error.message, error.details);
  }

  return {
    place: (userId: string, request: PlaceOrderRequest) =>
      act(userId, 'ORDER_PLACE', { orderId: null, request }, () => desk.place(userId, request)),

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
