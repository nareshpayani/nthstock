import { createTradingStore } from '@nthstock/apiClient';
import type { AccountState, Instrument, Position, TrailingStop } from '@nthstock/contracts';
import { formatInr } from '@nthstock/utils';
import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTrailingSheetStore } from '@/shared/lib/trailingSheetStore';
import { renderWithProviders } from '@/test/renderWithProviders';
import { phoneChartHeight } from './PhoneStockDetail';
import { PositionStrip } from './PositionStrip';

const AT = '2026-09-28T04:30:00.000Z';
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
const position: Position = {
  token: instrument.token,
  symbol: 'INFY',
  exchange: 'NSE',
  product: 'INTRADAY',
  netQty: 10,
  buyQty: 10,
  sellQty: 0,
  avgBuyPrice: 123_450,
  avgSellPrice: 0,
  ltp: 124_650,
  realisedPnl: 0,
  unrealisedPnl: 12_000,
};
const stop: TrailingStop = {
  id: 'ts_1',
  token: instrument.token,
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
  stopPrice: 122_840,
  protectedQty: 10,
  entryOrderId: null,
  exitOrderId: null,
  seq: 1,
  createdAt: AT,
  updatedAt: AT,
};
const account = (positions: Position[], trailingStops: TrailingStop[]): AccountState => ({
  seq: 1,
  orders: [],
  positions,
  trailingStops,
  funds: {
    openingBalance: 100_000_000,
    balance: 100_000_000,
    blocked: 0,
    available: 100_000_000,
    realisedPnlToday: 0,
    asOf: AT,
  },
});

describe('phone position strip (T12, SPEC-TFC-1 §9.4)', () => {
  it('shows quantity, average, P&L and the trailing stop from the store; nothing while flat', async () => {
    const store = createTradingStore({
      loadState: () => Promise.resolve(account([position], [stop])),
      schedule: (flush) => queueMicrotask(flush),
    });
    renderWithProviders(<PositionStrip instrument={instrument} />, { tradingStore: store });
    expect(screen.queryByTestId('position-strip')).not.toBeInTheDocument();
    await act(() => store.start());

    const strip = await screen.findByRole('region', { name: 'Your INFY position' });
    expect(strip).toHaveTextContent(`+10@ ${formatInr(123_450)}`);
    expect(strip).toHaveTextContent(`+${formatInr(12_000)}`);
    expect(strip).toHaveTextContent(`Trailing SL ${formatInr(122_840)}`);
    store.dispose();
  });

  it('tapping the position opens its trailing-stop sheet (T23)', async () => {
    const store = createTradingStore({
      loadState: () => Promise.resolve(account([position], [])),
      schedule: (flush) => queueMicrotask(flush),
    });
    renderWithProviders(<PositionStrip instrument={instrument} />, { tradingStore: store });
    await act(() => store.start());
    const line = await screen.findByRole('button', { name: /^\+10@ / });
    expect(line).toHaveAccessibleDescription('Opens the trailing stop for this position.');
    fireEvent.click(line);
    expect(useTrailingSheetStore.getState().target).toEqual({
      symbol: 'INFY',
      exchange: 'NSE',
      token: instrument.token,
      product: 'INTRADAY',
    });
    useTrailingSheetStore.getState().closeSheet();
    store.dispose();
  });

  it('sizes the chart to the phone: about 40% of the height, within 220 to 480 px', () => {
    expect(phoneChartHeight(844)).toBe(338);
    expect(phoneChartHeight(500)).toBe(220);
    expect(phoneChartHeight(1400)).toBe(480);
  });
});
