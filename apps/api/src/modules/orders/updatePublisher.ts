import {
  ORDER_UPDATE_EVENT_VERSION,
  orderUpdatesChannel,
  type OrderUpdateEvent,
} from '@nthstock/contracts';
import type { Publisher, PublisherLog } from '../../ticks/publisher.js';
import type { OrderService } from './service.js';

export type OrderUpdatePublisher = {
  /** Stops publishing. Safe to call more than once. */
  stop(): void;
};

/**
 * Publishes every order change to its user's own Redis channel (T-133), as an `OrderUpdateEvent`;
 * apps/realtime delivers it on that user's connections only. A failed publish is logged once
 * until publishing recovers; the order book over REST stays the source of truth.
 */
export function startOrderUpdatePublisher(options: {
  orders: Pick<OrderService, 'onOrderUpdate'>;
  publisher: Publisher;
  log: PublisherLog;
}): OrderUpdatePublisher {
  const { orders, publisher, log } = options;
  let failing = false;
  const onPublished = () => {
    if (failing) log.info('Order update publishing recovered');
    failing = false;
  };
  const onFailed = (error: unknown) => {
    if (failing) return;
    failing = true;
    log.warn(
      `Order update publishing failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  };
  const stop = orders.onOrderUpdate((userId, order) => {
    const event: OrderUpdateEvent = { v: ORDER_UPDATE_EVENT_VERSION, userId, order };
    publisher
      .publish(orderUpdatesChannel(userId), JSON.stringify(event))
      .then(onPublished, onFailed);
  });
  return { stop };
}
