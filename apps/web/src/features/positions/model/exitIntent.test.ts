import { describe, expect, it } from 'vitest';
import { exitIntent } from './exitIntent';

describe('exitIntent (T-150)', () => {
  it('exits a long 10 INFY intraday position as SELL 10 INTRADAY', () => {
    expect(
      exitIntent({ symbol: 'INFY', exchange: 'NSE', product: 'INTRADAY', netQty: 10 }),
    ).toEqual({ symbol: 'INFY', exchange: 'NSE', side: 'SELL', qty: 10, product: 'INTRADAY' });
  });

  it('exits a short by buying it back, and has nothing to exit when closed', () => {
    expect(
      exitIntent({ symbol: 'TCS', exchange: 'NSE', product: 'INTRADAY', netQty: -3 }),
    ).toMatchObject({ side: 'BUY', qty: 3, product: 'INTRADAY' });
    expect(
      exitIntent({ symbol: 'TCS', exchange: 'NSE', product: 'DELIVERY', netQty: 0 }),
    ).toBeNull();
  });
});
