import { WS_MAX_SUBSCRIPTIONS } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { createSubscriptionRegistry, subscriptionKey, type SubscriptionKey } from './registry.js';

const keys = (count: number, from = 0): SubscriptionKey[] =>
  Array.from({ length: count }, (_, i) => subscriptionKey(`S${from + i}`, 'NSE'));

describe('subscription registry', () => {
  it('keeps per-connection and per-symbol sets in step', () => {
    const registry = createSubscriptionRegistry<string>();
    registry.add('a', ['NSE:INFY', 'NSE:TCS']);
    registry.add('b', ['NSE:INFY']);
    expect([...registry.subscribersOf('NSE:INFY')].sort()).toEqual(['a', 'b']);
    expect([...registry.subscribersOf('NSE:TCS')]).toEqual(['a']);
    expect([...registry.keysOf('a')]).toEqual(['NSE:INFY', 'NSE:TCS']);
    expect(registry.keyCount()).toBe(2);
    expect(registry.connectionCount()).toBe(2);
  });

  it('ignores keys already held', () => {
    const registry = createSubscriptionRegistry<string>();
    registry.add('a', ['NSE:INFY']);
    expect(registry.add('a', ['NSE:INFY', 'BSE:INFY'])).toEqual({
      added: ['BSE:INFY'],
      rejected: [],
    });
  });

  it(`rejects the ${WS_MAX_SUBSCRIPTIONS + 1}st symbol for one connection`, () => {
    const registry = createSubscriptionRegistry<string>();
    expect(registry.add('a', keys(WS_MAX_SUBSCRIPTIONS)).rejected).toEqual([]);
    expect(registry.add('a', keys(2, WS_MAX_SUBSCRIPTIONS))).toEqual({
      added: [],
      rejected: ['NSE:S200', 'NSE:S201'],
    });
    expect(registry.keysOf('a').size).toBe(WS_MAX_SUBSCRIPTIONS);
    // The cap is per connection: another connection still subscribes.
    expect(registry.add('b', keys(1, WS_MAX_SUBSCRIPTIONS)).added).toEqual(['NSE:S200']);
  });

  it('accepts up to the cap within one call and rejects the rest', () => {
    const registry = createSubscriptionRegistry<string>({ maxPerConnection: 2 });
    expect(registry.add('a', keys(3))).toEqual({
      added: ['NSE:S0', 'NSE:S1'],
      rejected: ['NSE:S2'],
    });
  });

  it('removes single keys and drops empty entries from both maps', () => {
    const registry = createSubscriptionRegistry<string>();
    registry.add('a', ['NSE:INFY', 'NSE:TCS']);
    expect(registry.remove('a', ['NSE:INFY', 'NSE:WIPRO'])).toEqual(['NSE:INFY']);
    expect(registry.subscribersOf('NSE:INFY').size).toBe(0);
    registry.remove('a', ['NSE:TCS']);
    expect(registry.connectionCount()).toBe(0);
    expect(registry.keyCount()).toBe(0);
    expect(registry.remove('ghost', ['NSE:TCS'])).toEqual([]);
  });

  it('clears a disconnected connection from both maps', () => {
    const registry = createSubscriptionRegistry<string>();
    registry.add('a', keys(WS_MAX_SUBSCRIPTIONS));
    registry.add('b', ['NSE:S0']);
    registry.removeConnection('a');
    registry.removeConnection('ghost');
    expect(registry.keysOf('a').size).toBe(0);
    expect(registry.connectionCount()).toBe(1);
    expect(registry.keyCount()).toBe(1);
    expect([...registry.subscribersOf('NSE:S0')]).toEqual(['b']);
  });
});
