import { Order, type OrderSide, type OrderType, type ProductType } from '@nthstock/contracts';
import { INTRADAY_SQUARE_OFF, getMarketStatus, isTradingDay, toIstParts } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import { INFY, TCS, createHarness, ist, seeded } from './testHarness.js';

const TOKENS = [INFY, TCS];
const SEED_HOLDINGS = { [INFY.token]: 20, [TCS.token]: 5 } as Record<number, number>;

describe('PaperEngine randomised multi-day runs (T-127 to T-130)', () => {
  it.each([1, 7, 42, 2026, 90210])(
    'keeps its invariants for seed %i',
    (seed) => {
      const rand = seeded(seed);
      const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
      const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;
      const { engine, clock, prices } = createHarness({
        at: ist(25, 9, 0),
        funds: { openingBalance: 2_00_000_00 },
        holdings: [
          [INFY.token, { qty: 20, investedValue: 28_000_00 }],
          [TCS.token, { qty: 5, investedValue: 18_000_00 }],
        ],
      });

      for (let step = 0; step < 400; step += 1) {
        const op = int(0, 9);
        const live = engine.orders().filter((o) => o.status === 'AMO' || o.status === 'OPEN');
        if (op <= 3) {
          const instrument = pick(TOKENS);
          const ltp = prices.getLtp(instrument.token) ?? 1_500_00;
          const type = pick<OrderType>(['MARKET', 'LIMIT']);
          const offsetTicks = int(-60, 60);
          engine.place({
            token: instrument.token,
            side: pick<OrderSide>(['BUY', 'SELL']),
            type,
            product: pick<ProductType>(['DELIVERY', 'INTRADAY']),
            qty: int(1, 20),
            ...(type === 'LIMIT' ? { price: ltp + offsetTicks * 5 } : {}),
          });
        } else if (op === 4 && live.length > 0) {
          const target = pick(live);
          engine.modify(target.id, rand() < 0.5 ? { qty: int(1, 20) } : { type: 'MARKET' });
        } else if (op === 5 && live.length > 0) {
          engine.cancel(pick(live).id);
        } else if (op <= 7) {
          const instrument = pick(TOKENS);
          const ltp = prices.getLtp(instrument.token) ?? 1_500_00;
          const next = ltp + int(-40, 40) * 5;
          prices.set(
            instrument.token,
            Math.min(instrument.upperCircuit, Math.max(instrument.lowerCircuit, next)),
          );
          engine.sync();
        } else {
          clock.advance(int(1, 360) * 60_000);
          engine.sync();
        }

        const now = clock.now();
        const orders = engine.orders();
        for (const o of orders) expect(Order.safeParse(o).success).toBe(true);

        // Funds: the ledger adds up and only live BUY orders hold cash.
        const entries = engine.ledger.entries();
        expect(entries.reduce((t, e) => t + e.amount, 0)).toBe(engine.ledger.available);
        const liveBuys = orders.filter(
          (o) => o.side === 'BUY' && (o.status === 'AMO' || o.status === 'OPEN'),
        );
        const blocked = liveBuys.reduce((t, o) => t + engine.ledger.blockedFor(o.id), 0);
        expect(blocked).toBe(engine.ledger.blocked);
        for (const o of orders) {
          if (o.status !== 'AMO' && o.status !== 'OPEN')
            expect(engine.ledger.blockedFor(o.id)).toBe(0);
        }

        // Status follows the clock: AMOs only while closed, OPEN only while open.
        const state = getMarketStatus(clock).state;
        if (state === 'open') expect(orders.filter((o) => o.status === 'AMO')).toEqual([]);
        else expect(orders.filter((o) => o.status === 'OPEN')).toEqual([]);

        // No open intraday position from the square-off until the next session.
        const afterSquareOff =
          !isTradingDay(now) ||
          toIstParts(now).minuteOfDay >= INTRADAY_SQUARE_OFF ||
          state !== 'open';
        if (afterSquareOff) {
          const open = engine
            .positions()
            .filter((p) => p.product === 'INTRADAY' && p.book.netQty !== 0);
          expect(open).toEqual([]);
        }

        // Delivery shares are conserved: seed + bought − sold = holdings + today's delivery.
        for (const { token } of TOKENS) {
          const filled = (side: OrderSide) =>
            orders
              .filter((o) => o.token === token && o.product === 'DELIVERY' && o.side === side)
              .reduce((t, o) => t + o.filledQty, 0);
          const held = engine.holdings().find((h) => h.token === token)?.lot.qty ?? 0;
          const today =
            engine.positions().find((p) => p.token === token && p.product === 'DELIVERY')?.book
              .netQty ?? 0;
          expect(held).toBeGreaterThanOrEqual(0);
          expect(today).toBeGreaterThanOrEqual(0);
          expect(held + today).toBe((SEED_HOLDINGS[token] ?? 0) + filled('BUY') - filled('SELL'));
        }
      }
      // The run crossed several sessions and reached every terminal status.
      expect(clock.now().getTime() - ist(25, 9, 0).getTime()).toBeGreaterThan(2 * 86_400_000);
      const statuses = new Set(engine.orders().map((o) => o.status));
      for (const status of ['EXECUTED', 'CANCELLED', 'REJECTED'] as const) {
        expect(statuses.has(status)).toBe(true);
      }
    },
    60_000,
  );
});
