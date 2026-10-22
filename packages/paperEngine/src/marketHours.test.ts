import { describe, expect, it } from 'vitest';
import { createHarness, ist, marketOrder, order } from './testHarness.js';

// 25 Sep 2026 is a Friday and an NSE trading day; 21:00 IST is long after the close.
const NIGHT = ist(25, 21, 0);

describe('market hours (SPEC-TFC-1 §10.3, T03)', () => {
  it('fills Delivery and Intraday orders at 21:00 IST when the market is always open', () => {
    const { engine } = createHarness({ at: NIGHT, marketHours: 'alwaysOpen' });

    expect(engine.place(marketOrder())).toMatchObject({
      ok: true,
      order: { product: 'DELIVERY', status: 'EXECUTED' },
    });
    expect(engine.place(marketOrder({ product: 'INTRADAY' }))).toMatchObject({
      ok: true,
      order: { product: 'INTRADAY', status: 'EXECUTED' },
    });
    expect(engine.place(order({ product: 'INTRADAY' }))).toMatchObject({
      ok: true,
      order: { status: 'OPEN' },
    });
  });

  it('keeps NSE hours by default: Delivery waits as an AMO and Intraday is refused', () => {
    const { engine } = createHarness({ at: NIGHT });

    expect(engine.place(marketOrder())).toMatchObject({ ok: true, order: { status: 'AMO' } });
    expect(engine.place(marketOrder({ product: 'INTRADAY' }))).toMatchObject({
      ok: false,
      code: 'INTRADAY_MARKET_CLOSED',
      order: { status: 'REJECTED' },
    });
  });

  it('still squares off Intraday positions at 15:20 IST on a trading day', () => {
    const { engine, clock } = createHarness({ at: ist(25, 15, 0), marketHours: 'alwaysOpen' });
    engine.place(marketOrder({ product: 'INTRADAY' }));
    const sells = () => engine.orders().filter((o) => o.side === 'SELL');
    expect(sells()).toEqual([]);

    clock.set(ist(25, 15, 25));
    engine.sync();
    expect(sells()).toMatchObject([{ product: 'INTRADAY', qty: 10, status: 'EXECUTED' }]);
  });
});
