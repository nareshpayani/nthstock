import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { createPgLiveOrderSource } from './pgLiveOrders.js';

// reconcile.integration.test.ts reads real rows; this covers a row the CHECK should never let in,
// on a scripted client.

const stopRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  user_id: 'u1',
  token: 7,
  status: 'TRAILING',
  direction: 'LONG',
  trail_unit: 'AMOUNT',
  trail_amount: '500',
  trail_basis_points: null,
  activation_price: null,
  watermark_price: '10500',
  stop_price: '10000',
  version: '4',
  ...extra,
});

/** A pool whose one client answers each query from the rows given for its table. */
function scriptedPool(stops: Record<string, unknown>[]) {
  const released: unknown[] = [];
  const client = {
    query: (sql: string) => {
      if (sql.includes('FROM trailing_stops')) return Promise.resolve({ rows: stops });
      return Promise.resolve({ rows: [] });
    },
    release: (error?: unknown) => released.push(error),
  };
  // The source only calls `connect`, then `query` and `release` on the client.
  const pool = { connect: () => Promise.resolve(client) } as unknown as Pick<Pool, 'connect'>;
  return { pool, released };
}

describe('createPgLiveOrderSource (NSTOCK-0388)', () => {
  it('skips and logs a stop row with no trail value for its unit, keeping the rest', async () => {
    const { pool, released } = scriptedPool([
      stopRow('st_bad', { trail_unit: 'PERCENT', trail_basis_points: null }),
      stopRow('st_ok'),
    ]);
    const warnings: { message: string; fields?: Record<string, unknown> }[] = [];
    const source = createPgLiveOrderSource(pool, {
      warn: (message, fields) => warnings.push({ message, ...(fields ? { fields } : {}) }),
    });

    const snapshot = await source.read(1, ['u1']);

    expect(snapshot.stops).toEqual([
      {
        stopId: 'st_ok',
        userId: 'u1',
        token: 7,
        version: 4,
        state: {
          status: 'TRAILING',
          direction: 'LONG',
          trail: { unit: 'AMOUNT', amount: 500 },
          activationPrice: null,
          watermarkPrice: 10_500,
          stopPrice: 10_000,
        },
      },
    ]);
    expect(warnings).toEqual([
      {
        message: 'Skipped a damaged trailing stop row',
        fields: { stopId: 'st_bad', userId: 'u1', trailUnit: 'PERCENT' },
      },
    ]);
    // The read committed, so the connection goes back to the pool unharmed.
    expect(released).toEqual([undefined]);
  });
});
