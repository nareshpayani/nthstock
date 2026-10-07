import { WS_MAX_SUBSCRIPTIONS, type Exchange } from '@nthstock/contracts';

/** `NSE:INFY`: one symbol on one exchange, the unit of subscription and fan-out. */
export type SubscriptionKey = `${Exchange}:${string}`;

export const subscriptionKey = (symbol: string, exchange: Exchange): SubscriptionKey =>
  `${exchange}:${symbol}`;

export type SubscribeResult = {
  /** Keys newly subscribed by this call. */
  added: SubscriptionKey[];
  /** Keys refused because the connection is at its cap. */
  rejected: SubscriptionKey[];
};

export type SubscriptionRegistry<C> = {
  /**
   * Subscribes `connection` to `keys` in order until it holds `maxPerConnection`; the rest are
   * rejected. Keys it already holds are neither added nor rejected.
   */
  add(connection: C, keys: readonly SubscriptionKey[]): SubscribeResult;
  /** Unsubscribes; returns the keys that were actually held. */
  remove(connection: C, keys: readonly SubscriptionKey[]): SubscriptionKey[];
  /** Forgets a connection entirely (on disconnect). */
  removeConnection(connection: C): void;
  /** Connections subscribed to `key`; empty when none. */
  subscribersOf(key: SubscriptionKey): ReadonlySet<C>;
  keysOf(connection: C): ReadonlySet<SubscriptionKey>;
  /** Connections holding at least one subscription. */
  connectionCount(): number;
  /** Keys with at least one subscriber. */
  keyCount(): number;
};

const EMPTY: ReadonlySet<never> = new Set();

/**
 * Who wants what (T-070): per-connection and per-symbol sets kept in step, so fan-out looks up the
 * subscribers of a tick in O(1) and a disconnect removes the connection from every symbol it held.
 */
export function createSubscriptionRegistry<C>(
  options: { maxPerConnection?: number } = {},
): SubscriptionRegistry<C> {
  const max = options.maxPerConnection ?? WS_MAX_SUBSCRIPTIONS;
  const byConnection = new Map<C, Set<SubscriptionKey>>();
  const byKey = new Map<SubscriptionKey, Set<C>>();

  const unlink = (connection: C, key: SubscriptionKey) => {
    const subscribers = byKey.get(key);
    if (!subscribers) return;
    subscribers.delete(connection);
    if (subscribers.size === 0) byKey.delete(key);
  };

  return {
    add(connection, keys) {
      const held = byConnection.get(connection) ?? new Set<SubscriptionKey>();
      const added: SubscriptionKey[] = [];
      const rejected: SubscriptionKey[] = [];
      for (const key of keys) {
        if (held.has(key)) continue;
        if (held.size >= max) {
          rejected.push(key);
          continue;
        }
        held.add(key);
        let subscribers = byKey.get(key);
        if (!subscribers) {
          subscribers = new Set();
          byKey.set(key, subscribers);
        }
        subscribers.add(connection);
        added.push(key);
      }
      if (held.size > 0) byConnection.set(connection, held);
      return { added, rejected };
    },
    remove(connection, keys) {
      const held = byConnection.get(connection);
      if (!held) return [];
      const removed: SubscriptionKey[] = [];
      for (const key of keys) {
        if (!held.delete(key)) continue;
        unlink(connection, key);
        removed.push(key);
      }
      if (held.size === 0) byConnection.delete(connection);
      return removed;
    },
    removeConnection(connection) {
      const held = byConnection.get(connection);
      if (!held) return;
      for (const key of held) unlink(connection, key);
      byConnection.delete(connection);
    },
    subscribersOf: (key) => byKey.get(key) ?? EMPTY,
    keysOf: (connection) => byConnection.get(connection) ?? EMPTY,
    connectionCount: () => byConnection.size,
    keyCount: () => byKey.size,
  };
}
