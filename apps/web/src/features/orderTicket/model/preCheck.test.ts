import { fromIst } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import { preCheckOrder, type PreCheckContext } from './preCheck';
import { defaultTicketValues, type TicketFormValues } from './ticketForm';

/** Monday 28 Sep 2026, 10:00 IST (open) and Saturday 26 Sep, 11:30 IST (closed). */
const OPEN = fromIst(2026, 9, 28, 10 * 60);
const SATURDAY = fromIst(2026, 9, 26, 11 * 60 + 30);

const ctx: PreCheckContext = {
  now: OPEN,
  instrument: { token: 501, symbol: 'INFY', exchange: 'NSE' },
  stats: { lowerCircuit: 136_000, upperCircuit: 166_000 },
  ltp: 151_235,
  availableCash: 100_000_000,
  forcedOpen: false,
};

const order = (values: Partial<TicketFormValues>): TicketFormValues => ({
  ...defaultTicketValues('BUY'),
  ...values,
});

describe('preCheckOrder: the paper engine rules in the ticket (T-136)', () => {
  it('passes a valid market and limit order', () => {
    expect(preCheckOrder(order({ qty: 10 }), ctx)).toEqual({ ok: true });
    expect(preCheckOrder(order({ type: 'LIMIT', price: 150_000 }), ctx)).toEqual({ ok: true });
  });

  it('puts a limit price outside the circuit band on the price field', () => {
    const result = preCheckOrder(order({ type: 'LIMIT', price: 170_000 }), ctx);
    expect(result).toMatchObject({ ok: false, code: 'OUTSIDE_CIRCUIT', field: 'price' });
    expect(!result.ok && result.message).toContain("outside today's range for INFY");
  });

  it('refuses a buy worth more than the available cash, in the engine’s words', () => {
    const result = preCheckOrder(order({ qty: 1_000 }), { ...ctx, availableCash: 1_000_000 });
    expect(result).toMatchObject({ ok: false, code: 'INSUFFICIENT_FUNDS', field: 'form' });
    expect(!result.ok && result.message).toBe(
      'Not enough cash: this order needs ₹15,12,350.00 and ₹10,000.00 is available.',
    );
  });

  it('leaves unknown funds, circuit band and holdings to the server', () => {
    expect(
      preCheckOrder(order({ side: 'SELL', qty: 1_000_000, type: 'LIMIT', price: 5 }), {
        ...ctx,
        stats: undefined,
        availableCash: undefined,
      }),
    ).toEqual({ ok: true });
  });

  it('refuses intraday while the market is closed, unless the mock market is forced open', () => {
    const intraday = order({ product: 'INTRADAY' });
    expect(preCheckOrder(intraday, { ...ctx, now: SATURDAY })).toMatchObject({
      ok: false,
      code: 'INTRADAY_MARKET_CLOSED',
      field: 'form',
    });
    expect(preCheckOrder(intraday, { ...ctx, now: SATURDAY, forcedOpen: true })).toEqual({
      ok: true,
    });
  });

  it('needs a price to value a market order', () => {
    expect(preCheckOrder(order({}), { ...ctx, ltp: null })).toMatchObject({
      ok: false,
      code: 'NO_PRICE',
      field: 'form',
    });
  });

  it('maps quantity problems to the qty field', () => {
    expect(preCheckOrder(order({ qty: null }), ctx)).toMatchObject({ field: 'qty' });
    expect(
      preCheckOrder(order({ qty: Number.MAX_SAFE_INTEGER, type: 'LIMIT', price: 150_000 }), {
        ...ctx,
        stats: undefined,
      }),
    ).toMatchObject({ code: 'ORDER_TOO_LARGE', field: 'qty' });
  });
});
