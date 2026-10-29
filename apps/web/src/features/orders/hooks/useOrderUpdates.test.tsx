import type { Order } from '@nthstock/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFillToasts } from '@/shared/lib/fillToasts';
import { OrderUpdatesContext, type OrderUpdateSource } from '@/shared/lib/orderUpdatesContext';
import { initialSessionState, useSessionStore } from '@/shared/lib/sessionStore';
import { orderCue } from '@/shared/motion/orderCues';
import { testOrder } from '@/test/orders';
import { useOrderUpdates } from './useOrderUpdates';

vi.mock('@/shared/motion/orderCues', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  orderCue: vi.fn(),
}));

function setup() {
  let listener: (order: Order) => void = () => undefined;
  const source: OrderUpdateSource = {
    connect: vi.fn(),
    onOrderUpdate: (next) => {
      listener = next;
      return () => undefined;
    },
  };
  const onFill = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>
      <OrderUpdatesContext.Provider value={source}>{children}</OrderUpdatesContext.Provider>
    </QueryClientProvider>
  );
  renderHook(() => useOrderUpdates(onFill), { wrapper });
  return { send: (order: Order) => listener(order), onFill };
}

describe('useOrderUpdates fill cues (A17)', () => {
  beforeEach(() => {
    resetFillToasts();
    vi.mocked(orderCue).mockClear();
    useSessionStore.setState({ ...initialSessionState, status: 'authenticated' });
  });
  afterEach(() => useSessionStore.setState(initialSessionState));

  it('cues a rising sound for a buy fill and a falling one for a sell fill', () => {
    const { send, onFill } = setup();
    send(testOrder({ id: 'b1', side: 'BUY', status: 'EXECUTED', filledQty: 10 }));
    send(testOrder({ id: 's1', side: 'SELL', status: 'EXECUTED', filledQty: 10 }));
    expect(vi.mocked(orderCue).mock.calls).toEqual([['filledBuy'], ['filledSell']]);
    expect(onFill).toHaveBeenCalledTimes(2);
  });

  it('cues once per fill event, even when the update arrives twice', () => {
    const { send } = setup();
    const filled = testOrder({ id: 'b2', status: 'EXECUTED', filledQty: 10 });
    send(filled);
    send(filled);
    expect(orderCue).toHaveBeenCalledTimes(1);
  });

  it('stays silent for an update that is not a fill', () => {
    const { send, onFill } = setup();
    send(testOrder({ id: 'o1', status: 'OPEN', filledQty: 0 }));
    expect(orderCue).not.toHaveBeenCalled();
    expect(onFill).not.toHaveBeenCalled();
  });
});
