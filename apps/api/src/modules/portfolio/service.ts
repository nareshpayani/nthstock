import type { HoldingsResponse, PortfolioSummary, PositionsResponse } from '@nthstock/contracts';
import type { OrderService } from '../orders/service.js';
import type { PortfolioUserId } from './schema.js';

export type PortfolioServiceDeps = {
  /** The paper accounts: positions, holdings and prices come from the orders module's desk. */
  orders: Pick<OrderService, 'positions' | 'holdings' | 'portfolioSummary'>;
};

export type PortfolioService = ReturnType<typeof createPortfolioService>;

/**
 * Positions, holdings and the portfolio summary (T-141), derived from the user's paper engine:
 * P&L comes from the paperEngine math (`positionValues`, `holdingValues`) at the LTP the engines
 * see, so the numbers match what an order would fill at. Nothing is cached between requests.
 */
export function createPortfolioService({ orders }: PortfolioServiceDeps) {
  return {
    async positions(userId: PortfolioUserId): Promise<PositionsResponse> {
      return { items: await orders.positions(userId) };
    },
    async holdings(userId: PortfolioUserId): Promise<HoldingsResponse> {
      return { items: await orders.holdings(userId) };
    },
    summary: (userId: PortfolioUserId): Promise<PortfolioSummary> =>
      orders.portfolioSummary(userId),
  };
}
