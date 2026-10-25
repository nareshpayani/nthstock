import {
  ORDER_UPDATES_CHANNEL_PREFIX,
  UserChannelEvent,
  orderUpdatesChannel,
  type AccountDeltaEvent,
  type Order,
} from '@nthstock/contracts';
import { Redis } from 'ioredis';
import { silentLogger, type Logger } from '../logger.js';

export type OrderUpdateListener = (userId: string, order: Order) => void;

/** The account change an `AccountDeltaEvent` carries (NSTOCK-0368), without its envelope. */
export type AccountDelta = AccountDeltaEvent['delta'];
export type AccountDeltaListener = (userId: string, delta: AccountDelta) => void;

/**
 * Where per-user order updates and account deltas come from (T-133, NSTOCK-0368): Redis in a
 * running server, in memory in tests. A feed only delivers events for users being watched, that
 * is, users with a connection on this node, so a node never even receives another node's users'
 * orders.
 */
export type OrderFeed = {
  /** Starts receiving `userId`'s events; call the result to stop. Counted per user. */
  watch(userId: string): () => void;
  onOrderUpdate(listener: OrderUpdateListener): () => void;
  onAccountDelta(listener: AccountDeltaListener): () => void;
  close(): Promise<void>;
};

/** Counts watchers per user and calls `first` / `last` when a user gains or loses the first one. */
function watchCounter(first: (userId: string) => void, last: (userId: string) => void) {
  const watchers = new Map<string, number>();
  return {
    watch(userId: string) {
      const count = watchers.get(userId) ?? 0;
      watchers.set(userId, count + 1);
      if (count === 0) first(userId);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const left = (watchers.get(userId) ?? 1) - 1;
        if (left > 0) {
          watchers.set(userId, left);
          return;
        }
        watchers.delete(userId);
        last(userId);
      };
    },
    has: (userId: string) => watchers.has(userId),
    clear: () => watchers.clear(),
  };
}

function listenerSet<T>() {
  const listeners = new Set<(userId: string, payload: T) => void>();
  return {
    add(listener: (userId: string, payload: T) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(userId: string, payload: T) {
      for (const listener of [...listeners]) listener(userId, payload);
    },
    clear: () => listeners.clear(),
  };
}

export type RedisOrderFeed = OrderFeed & {
  /** Resolves once every pending SUBSCRIBE and UNSUBSCRIBE has been acknowledged (tests). */
  settled(): Promise<void>;
};

/**
 * Reads one message from a user's order channel: the event when it parses as a `UserChannelEvent`
 * (an order update or an account delta) whose `userId` matches the channel's, otherwise null.
 */
export function parseUserChannelMessage(channel: string, message: string): UserChannelEvent | null {
  if (!channel.startsWith(ORDER_UPDATES_CHANNEL_PREFIX)) return null;
  const userId = channel.slice(ORDER_UPDATES_CHANNEL_PREFIX.length);
  let json: unknown;
  try {
    json = JSON.parse(message);
  } catch {
    return null;
  }
  const parsed = UserChannelEvent.safeParse(json);
  return parsed.success && parsed.data.userId === userId ? parsed.data : null;
}

/**
 * Subscribes to the order channel of each user with a connection here (`orderUpdatesChannel`),
 * and unsubscribes when their last connection closes. A message is delivered only when it parses
 * as a `UserChannelEvent` whose `userId` matches its channel; anything else is dropped and logged.
 */
export function createRedisOrderFeed(options: { url: string; logger?: Logger }): RedisOrderFeed {
  const logger = options.logger ?? silentLogger;
  const listeners = listenerSet<Order>();
  const deltaListeners = listenerSet<AccountDelta>();
  const client = new Redis(options.url);
  let pending: Promise<unknown> = Promise.resolve();
  const queue = (command: () => Promise<unknown>) => {
    // Commands go in order, so a quick unwatch-then-watch ends subscribed.
    pending = pending.then(command).catch((error: unknown) => {
      logger.warn('Redis order feed command failed', { error: String(error) });
    });
  };
  const watchers = watchCounter(
    (userId) => queue(() => client.subscribe(orderUpdatesChannel(userId))),
    (userId) => queue(() => client.unsubscribe(orderUpdatesChannel(userId))),
  );
  let down = false;
  client.on('error', (error: Error) => {
    if (down) return;
    down = true;
    logger.warn('Redis order feed unavailable', { error: error.message });
  });
  client.on('ready', () => {
    if (down) logger.info('Redis order feed reconnected');
    down = false;
  });
  client.on('message', (channel: string, message: string) => {
    if (!channel.startsWith(ORDER_UPDATES_CHANNEL_PREFIX)) return;
    const event = parseUserChannelMessage(channel, message);
    if (!event) {
      logger.warn('Dropped a malformed order channel event', { channel });
      return;
    }
    if (!watchers.has(event.userId)) return;
    if ('type' in event) deltaListeners.emit(event.userId, event.delta);
    else listeners.emit(event.userId, event.order);
  });
  return {
    watch: watchers.watch,
    onOrderUpdate: listeners.add,
    onAccountDelta: deltaListeners.add,
    settled: () => pending.then(() => undefined),
    async close() {
      listeners.clear();
      deltaListeners.clear();
      watchers.clear();
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    },
  };
}

export type MemoryOrderFeed = OrderFeed & {
  /** Publishes an update, as apps/api does; delivered only while `userId` is watched. */
  emit(userId: string, order: Order): void;
  /** Publishes an account delta (NSTOCK-0368); delivered only while `userId` is watched. */
  emitDelta(userId: string, delta: AccountDelta): void;
  watching(userId: string): boolean;
};

export function createMemoryOrderFeed(): MemoryOrderFeed {
  const listeners = listenerSet<Order>();
  const deltaListeners = listenerSet<AccountDelta>();
  const watchers = watchCounter(
    () => undefined,
    () => undefined,
  );
  return {
    watch: watchers.watch,
    onOrderUpdate: listeners.add,
    onAccountDelta: deltaListeners.add,
    emit(userId, order) {
      if (watchers.has(userId)) listeners.emit(userId, order);
    },
    emitDelta(userId, delta) {
      if (watchers.has(userId)) deltaListeners.emit(userId, delta);
    },
    watching: watchers.has,
    close() {
      listeners.clear();
      deltaListeners.clear();
      watchers.clear();
      return Promise.resolve();
    },
  };
}
