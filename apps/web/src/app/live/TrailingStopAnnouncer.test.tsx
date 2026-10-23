import { createTradingStore, type TradingSource } from '@nthstock/apiClient';
import {
  WS_PROTOCOL_VERSION,
  type AccountState,
  type TrailingStop,
  type WsAccountDelta,
} from '@nthstock/contracts';
import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import {
  STOP_ANNOUNCEMENTS,
  TrailingStopAnnouncer,
  stopAnnouncement,
} from './TrailingStopAnnouncer';

const AT = '2026-09-28T04:30:00.000Z';
const STOP: TrailingStop = {
  id: 'ts_1',
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  product: 'INTRADAY',
  direction: 'LONG',
  trail: { unit: 'AMOUNT', amount: 1_000 },
  activationPrice: null,
  exitOrderType: 'MARKET',
  exitLimitOffset: null,
  status: 'TRAILING',
  statusReason: null,
  watermarkPrice: 124_650,
  stopPrice: 123_650,
  protectedQty: 5,
  entryOrderId: null,
  exitOrderId: null,
  seq: 1,
  createdAt: AT,
  updatedAt: AT,
};

describe('trailing-stop announcements (T24, SPEC-TFC-1 §13)', () => {
  it('a trigger is polite and names the exit', () => {
    expect(stopAnnouncement('TRAILING', { ...STOP, status: 'TRIGGERED' }, false)).toEqual({
      title: 'Trailing stop triggered',
      description: 'Exiting 5 INFY at market. The stop was ₹1,236.50.',
      tone: 'info',
    });
  });

  it('a failed exit is an alert', () => {
    expect(
      stopAnnouncement(
        'TRIGGERED',
        { ...STOP, status: 'REJECTED', statusReason: 'Market closed' },
        false,
      ),
    ).toEqual({
      title: 'Trailing stop exit failed',
      description: 'INFY: Market closed. Your position is still open.',
      tone: 'error',
    });
  });

  it('a cancellation the user did not ask for is announced with its reason; their own is not', () => {
    const closed = { ...STOP, status: 'CANCELLED' as const, statusReason: 'Position closed' };
    expect(stopAnnouncement('TRAILING', closed, false)?.description).toBe('INFY: Position closed');
    expect(stopAnnouncement('TRAILING', closed, true)).toBeNull();
  });

  it('says nothing when the status did not change, or for an exit that filled', () => {
    expect(stopAnnouncement('TRAILING', STOP, false)).toBeNull();
    expect(stopAnnouncement('TRIGGERED', { ...STOP, status: 'EXECUTED' }, false)).toBeNull();
    expect(stopAnnouncement(undefined, { ...STOP, status: 'CANCELLED' }, false)).toBeNull();
  });

  it('announces the engine moving a stop, but not the stops already there at load', async () => {
    const listeners = new Set<(delta: WsAccountDelta) => void>();
    const source: TradingSource = {
      onAccountDelta: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      focus: () => undefined,
    };
    const account: AccountState = {
      seq: 1,
      orders: [],
      positions: [],
      trailingStops: [
        { ...STOP, id: 'ts_old', status: 'CANCELLED', statusReason: 'Expired' },
        STOP,
      ],
      funds: {
        openingBalance: 100_000_000,
        balance: 100_000_000,
        blocked: 0,
        available: 100_000_000,
        realisedPnlToday: 0,
        asOf: AT,
      },
    };
    const store = createTradingStore({
      source,
      loadState: () => Promise.resolve(account),
      schedule: (flush) => queueMicrotask(flush),
    });
    renderWithProviders(<TrailingStopAnnouncer />, { tradingStore: store });
    await act(() => store.start());
    expect(screen.queryByText(STOP_ANNOUNCEMENTS.cancelled)).not.toBeInTheDocument();

    const frame = (stop: TrailingStop) => {
      const delta: WsAccountDelta = {
        v: WS_PROTOCOL_VERSION,
        type: 'accountDelta',
        seq: store.getState().seq + 1,
        at: AT,
        quotes: [],
        orders: [],
        positions: [],
        trailingStops: [stop],
      };
      act(() => {
        for (const listener of listeners) listener(delta);
      });
    };
    frame({ ...STOP, status: 'TRIGGERED', seq: 2 });
    expect(await screen.findByText('Trailing stop triggered')).toBeInTheDocument();
    frame({ ...STOP, status: 'REJECTED', statusReason: 'No liquidity', seq: 3 });
    expect(await screen.findByText('Trailing stop exit failed')).toBeInTheDocument();
    expect(
      screen.getByText('INFY: No liquidity. Your position is still open.'),
    ).toBeInTheDocument();
    store.dispose();
  });
});
