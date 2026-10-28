import { createTradingStore } from '@nthstock/apiClient';
import type { AccountState, Instrument } from '@nthstock/contracts';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { InstrumentOrders } from './InstrumentOrders';

const instrument: Instrument = {
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  name: 'Infosys Ltd',
  type: 'EQUITY',
  isin: 'INE009A01021',
  sector: 'Information Technology',
  lotSize: 1,
  tickSize: 5,
};

const emptyAccount: AccountState = {
  seq: 1,
  orders: [],
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

describe('InstrumentOrders tab states', () => {
  it('says loading, not "no orders", while the trading store loads', async () => {
    const store = createTradingStore({
      loadState: () => new Promise<AccountState>(() => undefined),
      schedule: (flush) => queueMicrotask(flush),
    });
    void store.start();
    renderWithProviders(<InstrumentOrders instrument={instrument} />, { tradingStore: store });
    expect(await screen.findByRole('status')).toHaveTextContent('Loading orders');
    expect(screen.queryByText('No INFY orders today.')).not.toBeInTheDocument();
    store.dispose();
  });

  it('says unavailable, not "no orders", when the trading store failed to load', async () => {
    const store = createTradingStore({
      loadState: () => Promise.reject(new Error('down')),
      schedule: (flush) => queueMicrotask(flush),
    });
    await store.start();
    expect(store.getState().status).toBe('error');
    renderWithProviders(<InstrumentOrders instrument={instrument} />, { tradingStore: store });
    expect(await screen.findByText(/Couldn't load your orders/)).toBeInTheDocument();
    expect(screen.queryByText('No INFY orders today.')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All orders' })).toBeInTheDocument();
    store.dispose();
  });

  it('shows "no orders" only once the orders are known to be empty', async () => {
    const store = createTradingStore({
      loadState: () => Promise.resolve(emptyAccount),
      schedule: (flush) => queueMicrotask(flush),
    });
    await store.start();
    renderWithProviders(<InstrumentOrders instrument={instrument} />, { tradingStore: store });
    expect(await screen.findByText('No INFY orders today.')).toBeInTheDocument();
    store.dispose();
  });
});
