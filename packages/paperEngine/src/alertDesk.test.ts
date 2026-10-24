import { PRICE_ALERTS_MAX_ACTIVE, type Notification, type Quote } from '@nthstock/contracts';
import { fixedClock } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import { AlertDesk, type AlertMarket } from './alertDesk.js';
import { createSequentialIds } from './context.js';

const quote = (symbol: string, token: number, ltp: number): Quote => ({
  token,
  symbol,
  exchange: 'NSE',
  ltp,
  change: 0,
  changeBp: 0,
  open: ltp,
  high: ltp,
  low: ltp,
  prevClose: ltp,
  volume: 0,
  ts: '2026-10-26T05:00:00.000Z',
});

function setup() {
  const prices = new Map<string, Quote>([
    ['INFY', quote('INFY', 1594, 152_000)],
    ['TCS', quote('TCS', 11536, 400_000)],
  ]);
  const listeners = new Map<string, (quotes: readonly Quote[]) => void>();
  const market: AlertMarket = {
    getQuote: (symbol) => Promise.resolve(prices.get(symbol) ?? null),
    subscribe: (symbols, listener) => {
      const [symbol] = symbols;
      if (symbol) listeners.set(symbol, listener);
      return () => {
        if (symbol) listeners.delete(symbol);
      };
    },
  };
  const pushed: { userId: string; notification: Notification; alertId?: string }[] = [];
  const changed: string[] = [];
  const desk = new AlertDesk({
    clock: fixedClock(new Date('2026-10-26T05:00:00.000Z')),
    market,
    newId: createSequentialIds('id'),
    onNotification: (userId, notification, alert) => {
      pushed.push({ userId, notification, ...(alert ? { alertId: alert.id } : {}) });
    },
    onChange: (userId) => changed.push(userId),
  });
  const tick = (symbol: string, ltp: number) => {
    const base = prices.get(symbol);
    if (!base) throw new Error(symbol);
    listeners.get(symbol)?.([{ ...base, ltp }]);
  };
  return { desk, tick, listeners, pushed, changed };
}

describe('AlertDesk (NSTOCK-0344)', () => {
  it('fires an ABOVE alert once, on the first tick at or past its price, and notifies', async () => {
    const { desk, tick, listeners, pushed } = setup();
    const created = await desk.create('u1', { symbol: 'INFY', condition: 'ABOVE', price: 153_000 });
    expect(created).toMatchObject({ ok: true, alert: { status: 'ACTIVE', createdLtp: 152_000 } });
    expect(listeners.has('INFY')).toBe(true);

    tick('INFY', 152_995);
    expect(desk.alerts('u1')[0]?.status).toBe('ACTIVE');
    tick('INFY', 153_000);
    tick('INFY', 153_500);

    const [alert] = desk.alerts('u1');
    expect(alert).toMatchObject({ status: 'TRIGGERED', triggeredLtp: 153_000 });
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({
      userId: 'u1',
      alertId: alert?.id,
      notification: {
        kind: 'PRICE_ALERT',
        title: 'INFY crossed above ₹1,530.00',
        body: 'Now ₹1,530.00',
        symbol: 'INFY',
        read: false,
      },
    });
    // No active alert is left on INFY, so the desk stops watching it.
    expect(listeners.has('INFY')).toBe(false);
  });

  it('fires a BELOW alert on a gap past its level with the LTP that crossed, and shows the note', async () => {
    const { desk, tick, pushed } = setup();
    await desk.create('u1', {
      symbol: 'INFY',
      condition: 'BELOW',
      price: 150_000,
      note: 'Add more',
    });
    tick('INFY', 148_000);
    expect(desk.alerts('u1')[0]).toMatchObject({ status: 'TRIGGERED', triggeredLtp: 148_000 });
    expect(pushed[0]?.notification.body).toBe('Now ₹1,480.00 · Add more');
  });

  it('refuses a level the price has already reached, an unknown symbol and too many alerts', async () => {
    const { desk } = setup();
    expect(await desk.create('u1', { symbol: 'INFY', condition: 'ABOVE', price: 151_000 })).toEqual(
      {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Set a price above the current ₹1,520.00',
      },
    );
    expect(
      await desk.create('u1', { symbol: 'INFY', condition: 'BELOW', price: 152_000 }),
    ).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    expect(
      await desk.create('u1', { symbol: 'NOPE', condition: 'BELOW', price: 100 }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });

    for (let i = 0; i < PRICE_ALERTS_MAX_ACTIVE; i += 1) {
      await desk.create('u1', { symbol: 'TCS', condition: 'ABOVE', price: 400_005 + i * 5 });
    }
    expect(
      await desk.create('u1', { symbol: 'INFY', condition: 'ABOVE', price: 160_000 }),
    ).toMatchObject({ ok: false, code: 'LIMIT_REACHED' });
  });

  it('keeps users apart and stops watching only when no user has an active alert', async () => {
    const { desk, tick, listeners, pushed } = setup();
    const mine = await desk.create('u1', { symbol: 'INFY', condition: 'ABOVE', price: 153_000 });
    await desk.create('u2', { symbol: 'INFY', condition: 'ABOVE', price: 155_000 });
    if (!mine.ok) throw new Error('create failed');

    expect(desk.cancel('u2', mine.alert.id)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(desk.cancel('u1', mine.alert.id)).toMatchObject({
      ok: true,
      alert: { status: 'CANCELLED' },
    });
    expect(desk.cancel('u1', mine.alert.id)).toMatchObject({ ok: false, code: 'INVALID_STATE' });
    expect(listeners.has('INFY')).toBe(true);

    tick('INFY', 156_000);
    expect(pushed.map((p) => p.userId)).toEqual(['u2']);
    expect(desk.alerts('u1')[0]?.status).toBe('CANCELLED');
  });

  it('lists active alerts first, then ended ones', async () => {
    const { desk, tick } = setup();
    await desk.create('u1', { symbol: 'TCS', condition: 'ABOVE', price: 401_000 });
    await desk.create('u1', { symbol: 'INFY', condition: 'ABOVE', price: 160_000 });
    tick('TCS', 402_000);
    expect(desk.alerts('u1').map((a) => [a.symbol, a.status])).toEqual([
      ['INFY', 'ACTIVE'],
      ['TCS', 'TRIGGERED'],
    ]);
  });

  it('counts unread, marks some or all read, and takes notifications from the backend', () => {
    const { desk, changed } = setup();
    const fill = desk.notify('u1', {
      kind: 'ORDER_FILLED',
      title: 'Order executed',
      body: 'BUY 10 INFY @ ₹1,520.00',
      symbol: 'INFY',
      exchange: 'NSE',
    });
    desk.notify('u1', { kind: 'TRAILING_STOP', title: 'Trailing stop triggered', body: 'INFY' });
    expect(desk.notifications('u1').unread).toBe(2);
    expect(desk.markRead('u1', [fill.id])).toMatchObject({ unread: 1 });
    expect(desk.markRead('u1').unread).toBe(0);
    const before = changed.length;
    desk.markRead('u1');
    expect(changed).toHaveLength(before);
    expect(desk.notifications('u2')).toEqual({ items: [], unread: 0 });
  });

  it('restores a snapshot and watches its active alerts again', async () => {
    const first = setup();
    await first.desk.create('u1', { symbol: 'INFY', condition: 'ABOVE', price: 153_000 });
    const saved = JSON.parse(JSON.stringify(first.desk.snapshot())) as ReturnType<
      AlertDesk['snapshot']
    >;
    first.desk.close();
    expect(first.listeners.size).toBe(0);

    const second = setup();
    second.desk.restore(saved);
    second.tick('INFY', 153_100);
    expect(second.desk.alerts('u1')[0]?.status).toBe('TRIGGERED');
    expect(second.pushed).toHaveLength(1);
  });
});
