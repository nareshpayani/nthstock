import { createTradingStore, type TradingState } from '@nthstock/apiClient';
import type { AccountState, WsAccountDelta } from '@nthstock/contracts';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { TradingStoreContext } from '@/shared/lib/tradingStoreContext';
import { testOrder } from '@/test/orders';
import { useTradingSelector } from './useTradingSelector';

const state: AccountState = {
  seq: 1,
  orders: [testOrder({ id: 'pe_a', seq: 1 })],
  positions: [],
  trailingStops: [],
  funds: {
    openingBalance: 100_000_000,
    balance: 100_000_000,
    blocked: 0,
    available: 100_000_000,
    realisedPnlToday: 0,
    asOf: '2026-09-28T04:30:00.000Z',
  },
};

const frame = (seq: number, extra: Partial<WsAccountDelta>): WsAccountDelta => ({
  v: 1,
  type: 'accountDelta',
  seq,
  at: '2026-09-28T04:30:00.000Z',
  quotes: [],
  orders: [],
  positions: [],
  trailingStops: [],
  ...extra,
});

const openIds = (s: TradingState) =>
  s.orders.filter((order) => order.status === 'OPEN').map((order) => order.id);
const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

async function readyStore() {
  const store = createTradingStore({ loadState: () => Promise.resolve(state), schedule: () => {} });
  await store.start();
  store.flush();
  return store;
}

describe('useTradingSelector (T10)', () => {
  it('reads an idle, empty store without a provider', () => {
    const { result } = renderHook(() => useTradingSelector((s) => s.status));
    expect(result.current).toBe('idle');
  });

  it('re-renders on a commit that changes the slice, and not on one that leaves it equal', async () => {
    const store = await readyStore();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TradingStoreContext.Provider value={store}>{children}</TradingStoreContext.Provider>
    );
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders += 1;
        return useTradingSelector(openIds, sameIds);
      },
      { wrapper },
    );
    expect(result.current).toEqual(['pe_a']);
    const first = result.current;
    const before = renders;

    // An open order's price changes, the set of open orders does not: same array, no render.
    act(() => {
      store.ingest(frame(2, { orders: [testOrder({ id: 'pe_a', seq: 2, price: 151_500 })] }));
      store.flush();
    });
    expect(result.current).toBe(first);
    expect(renders).toBe(before);

    act(() => {
      store.ingest(frame(3, { orders: [testOrder({ id: 'pe_b', seq: 3 })] }));
      store.flush();
    });
    expect(result.current).toEqual(['pe_b', 'pe_a']);
    expect(renders).toBe(before + 1);
  });
});
