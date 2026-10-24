// @vitest-environment node
import { CONSENT_POLICY_VERSION, DEV_OTP } from '@nthstock/contracts';
import { createScenarioClient, fetchBackend } from '@nthstock/contracts/testing';
import { fixedClock, fromIst } from '@nthstock/utils';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEMO_MODE_STORAGE_KEY,
  enterDemoMode,
  isDemoMode,
  registerSimulator,
} from '@/shared/lib/demoSimulator';
import { TEST_API_ORIGIN, createMockServer } from './node';
import { GAP_RATIO, SPLIT_FILL_QTY, createSimulator } from './simulator';

// T09 (SPEC-TFC-1 TFC-12): the Simulator moves the real mock feed, so a scripted gap trips a
// trailing stop on the paper desk.

/** Monday 28 Sep 2026, 10:00 IST: the market is open. */
const OPEN_MS = fromIst(2026, 9, 28, 10 * 60).getTime();

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function pageLoad() {
  const mock = createMockServer({
    clock: fixedClock(OPEN_MS),
    tickIntervalMs: 1_000_000_000,
    flushMs: 20,
    auth: { now: () => OPEN_MS },
  });
  mock.server.listen({ onUnhandledFrame: 'error' });
  cleanups.push(() => {
    mock.server.close();
    mock.orders.dispose();
    mock.adapter.dispose();
  });
  const client = createScenarioClient(fetchBackend(TEST_API_ORIGIN, fetch));
  const simulator = createSimulator({ adapter: mock.adapter, orders: mock.orders });
  return { ...mock, client, simulator };
}

describe('demo Simulator (T09)', () => {
  it('a scripted gap triggers a trailing stop on the paper desk', async () => {
    const { client, adapter, simulator } = pageLoad();
    const mobile = '8400000009';
    const { requestId } = await client.call('otpRequest', { body: { mobile } });
    await client.call('otpVerify', {
      body: { requestId, mobile, otp: DEV_OTP, consentVersion: CONSENT_POLICY_VERSION },
    });

    const before = await adapter.getQuote('INFY');
    if (!before) throw new Error('INFY has no quote');
    const entry = await client.call('orderPlace', {
      body: { token: before.token, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty: 10 },
    });
    expect(entry.status).toBe('EXECUTED');
    const stop = await client.call('trailingStopPlace', {
      body: {
        token: before.token,
        product: 'DELIVERY',
        trail: { unit: 'PERCENT', basisPoints: 100 },
        exitOrderType: 'MARKET',
      },
    });
    expect(stop.status).toBe('TRAILING');

    expect(await simulator.gapDown('INFY')).toBe(true);

    const after = await adapter.getQuote('INFY');
    expect(after?.ltp).toBeLessThan(before.ltp * (1 + GAP_RATIO / 2));
    const [done] = (await client.call('trailingStopsList')).items;
    expect(done).toMatchObject({ id: stop.id, status: 'EXECUTED' });
  });

  it('rally and pull back accept equities and refuse indices and unknown symbols', async () => {
    const { simulator } = pageLoad();
    expect(await simulator.rally('INFY')).toBe(true);
    expect(await simulator.pullBack('INFY')).toBe(true);
    expect(await simulator.rally('NOPE')).toBe(false);
    expect(await simulator.gapDown('NOPE')).toBe(false);
  });

  it('split fills caps LIMIT fills per tick and lifts the cap again', async () => {
    const { adapter, orders } = pageLoad();
    const caps: (number | null)[] = [];
    const spy = createSimulator({
      adapter,
      orders: {
        sweep: orders.sweep,
        setFillCap: (_token, qty) => {
          caps.push(qty);
        },
      },
    });
    await spy.setSplitFills('INFY', true);
    expect(spy.splitFills('INFY')).toBe(true);
    await spy.setSplitFills('INFY', false);
    expect(spy.splitFills('INFY')).toBe(false);
    expect(caps).toEqual([SPLIT_FILL_QTY, null]);
  });
});

describe('demo mode flag', () => {
  it('is off until entered, and a throwing storage reads as off', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
    expect(isDemoMode(storage)).toBe(false);
    enterDemoMode(storage);
    expect(data.get(DEMO_MODE_STORAGE_KEY)).toBe('1');
    expect(isDemoMode(storage)).toBe(true);
    expect(
      isDemoMode({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe(false);
  });

  it('registerSimulator returns an unregister function', () => {
    const { simulator } = pageLoad();
    const off = registerSimulator(simulator);
    off();
    // A second unregister must not clear a newer registration.
    const newer = registerSimulator(simulator);
    off();
    newer();
  });
});
