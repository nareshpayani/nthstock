import type { TradingCommit, TradingState } from '@nthstock/apiClient';
import type { FundsSummary, Order, PositionsResponse } from '@nthstock/contracts';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { fundsKeys, ordersKeys, positionsKeys } from '@/shared/lib/queryKeys';
import { testOrder } from '@/test/orders';
import { writeTradingCommit } from './tradingCache';

const funds: FundsSummary = {
  openingBalance: 100_000_000,
  balance: 100_000_000,
  blocked: 1_510_000,
  available: 98_490_000,
  realisedPnlToday: 0,
  asOf: '2026-09-28T04:30:00.000Z',
};

const state = (extra: Partial<TradingState> = {}): TradingState => ({
  status: 'ready',
  seq: 3,
  orders: [],
  positions: [],
  trailingStops: [],
  funds,
  depth: null,
  focus: null,
  pending: [],
  ...extra,
});

const commit = (extra: Partial<TradingCommit>): TradingCommit => ({
  state: state(),
  reloaded: false,
  orders: [],
  trailingStops: [],
  positionsChanged: false,
  fundsChanged: false,
  ...extra,
});

describe('writeTradingCommit (T10)', () => {
  it('writes funds, positions and cached order details, and nothing for an idle store', () => {
    const client = new QueryClient();
    const filled = testOrder({ id: 'pe_1', status: 'EXECUTED', seq: 3 });
    client.setQueryData(ordersKeys.detail('pe_1'), testOrder({ id: 'pe_1' }));

    writeTradingCommit(
      client,
      commit({ state: state({ status: 'idle' }), fundsChanged: true, orders: [filled] }),
    );
    expect(client.getQueryData(fundsKeys.summary())).toBeUndefined();

    writeTradingCommit(
      client,
      commit({
        fundsChanged: true,
        positionsChanged: true,
        orders: [filled, testOrder({ id: 'pe_2', seq: 2 })],
      }),
    );
    expect(client.getQueryData<FundsSummary>(fundsKeys.summary())).toEqual(funds);
    expect(client.getQueryData<PositionsResponse>(positionsKeys.list())).toEqual({ items: [] });
    expect(client.getQueryData<Order>(ordersKeys.detail('pe_1'))?.status).toBe('EXECUTED');
    expect(client.getQueryData(ordersKeys.detail('pe_2'))).toBeUndefined();
  });
});
