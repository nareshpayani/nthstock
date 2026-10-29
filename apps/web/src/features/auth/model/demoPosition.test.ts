import type { ApiClient } from '@nthstock/apiClient';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_POSITION_QTY, DEMO_TRAIL_BASIS_POINTS, openDemoPosition } from './demoPosition';

type Call = [string, unknown?];

/** A fake client: answers each endpoint from `responses`, records the calls. */
function fakeApi(responses: Record<string, () => unknown>) {
  const calls: Call[] = [];
  const request = vi.fn((name: string, options?: unknown) => {
    calls.push([name, options]);
    const respond = responses[name];
    return respond ? Promise.resolve().then(respond) : Promise.reject(new Error(name));
  });
  return { api: { request } as unknown as ApiClient, calls };
}

const position = (product: 'INTRADAY' | 'DELIVERY', netQty: number) => ({
  symbol: 'RELIANCE',
  product,
  netQty,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openDemoPosition (NSTOCK-0444)', () => {
  it('places an intraday market buy with a 1% trailing stop', async () => {
    const { api, calls } = fakeApi({
      positionsList: () => ({ items: [position('DELIVERY', 20)] }),
      instrument: () => ({ token: 2885 }),
      orderPlace: () => ({ id: 'o1' }),
    });

    await openDemoPosition(api, 'RELIANCE');

    expect(calls.map(([name]) => name)).toEqual(['positionsList', 'instrument', 'orderPlace']);
    expect(calls[2]?.[1]).toEqual({
      body: {
        token: 2885,
        side: 'BUY',
        type: 'MARKET',
        product: 'INTRADAY',
        qty: DEMO_POSITION_QTY,
        attachedTrailingStop: {
          trail: { unit: 'PERCENT', basisPoints: DEMO_TRAIL_BASIS_POINTS },
        },
      },
    });
  });

  it('skips the order when an intraday position is already open there', async () => {
    const { api, calls } = fakeApi({
      positionsList: () => ({ items: [position('INTRADAY', 10)] }),
    });

    await openDemoPosition(api, 'RELIANCE');

    expect(calls.map(([name]) => name)).toEqual(['positionsList']);
  });

  it('does not throw when the order is refused, and says why in the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { api } = fakeApi({
      positionsList: () => ({ items: [] }),
      instrument: () => ({ token: 2885 }),
    });

    await expect(openDemoPosition(api, 'RELIANCE')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});
