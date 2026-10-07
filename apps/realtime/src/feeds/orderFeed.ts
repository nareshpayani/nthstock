import {
  ORDER_UPDATES_CHANNEL_PREFIX,
  OrderUpdateEvent,
  orderUpdatesChannel,
  type Order,
} from '@nthstock/contracts';
import { Redis } from 'ioredis';
import { silentLogger, type Logger } from '../logger.js';

export type OrderUpdateListener = (userId: string, order: Order) => void;

/**
 * Where per-user order updates come from (T-133): Redis in a running server, in memory in tests.
 * A feed only delivers updates for users being watched, that is, users with a connection on this
 * node, so a node never even receives another node's users' orders.
 */
export type OrderFeed = {
  /** Starts receiving `userId`'s updates; call the result to stop. Counted per user. */
  watch(userId: string): () => void;
  onOrderUpdate(listener: OrderUpdateListener): () => void;
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

function listenerSet() {
  const listeners = new Set<OrderUpdateListener>();
  return {
    add(listener: OrderUpdateListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(userId: string, order: Order) {
      for (const listener of [...listeners]) listener(userId, order);
    },
    clear: () => listeners.clear(),
  };
}

export type RedisOrderFeed = OrderFeed & {
  /** Resolves once every pending SUBSCRIBE and UNSUBSCRIBE has been acknowledged (tests). */
  settled(): Promise<void>;
};

/**
 * Subscribes to the order channel of each user with a connection here (`orderUpdatesChannel`),
 * and unsubscribes when their last connection closes. A message is delivered only when it parses
 * as an `OrderUpdateEvent` whose `userId` matches its channel; anything else is dropped and logged.
 */
export function createRedisOrderFeed(options: { url: string; logger?: Logger }): RedisOrderFeed {
  const logger = options.logger ?? silentLogger;
  const listeners = listenerSet();
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
    const userId = channel.slice(ORDER_UPDATES_CHANNEL_PREFIX.length);
    let json: unknown;
    try {
      json = JSON.parse(message);
    } catch {
      json = undefined;
    }
    const parsed = OrderUpdateEvent.safeParse(json);
    if (!parsed.success || parsed.data.userId !== userId) {
      logger.warn('Dropped a malformed order update', { channel });
      return;
    }
    if (watchers.has(userId)) listeners.emit(userId, parsed.data.order);
  });
  return {
    watch: watchers.watch,
    onOrderUpdate: listeners.add,
    settled: () => pending.then(() => undefined),
    async close() {
      listeners.clear();
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
  watching(userId: string): boolean;
};

export function createMemoryOrderFeed(): MemoryOrderFeed {
  const listeners = listenerSet();
  const watchers = watchCounter(
    () => undefined,
    () => undefined,
  );
  return {
    watch: watchers.watch,
    onOrderUpdate: listeners.add,
    emit(userId, order) {
      if (watchers.has(userId)) listeners.emit(userId, order);
    },
    watching: watchers.has,
    close() {
      listeners.clear();
      watchers.clear();
      return Promise.resolve();
    },
  };
}
