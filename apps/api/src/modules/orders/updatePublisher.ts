import {
  ACCOUNT_DELTA_EVENT_VERSION,
  ORDER_UPDATE_EVENT_VERSION,
  orderUpdatesChannel,
  type AccountDeltaEvent,
  type OrderUpdateEvent,
} from '@nthstock/contracts';
import type { Publisher, PublisherLog } from '../../ticks/publisher.js';
import type { OrderService } from './service.js';

export type OrderUpdatePublisher = {
  /** Stops publishing. Safe to call more than once. */
  stop(): void;
};

/**
 * Publishes every order change to its user's own Redis channel (T-133), as an `OrderUpdateEvent`,
 * and after them each committed account change as an `AccountDeltaEvent` (NSTOCK-0368), which
 * apps/realtime turns into the `accountDelta` frames the trading store applies. Both reach that
 * user's connections only. A failed publish is logged once until publishing recovers; the REST
 * routes (`GET /v1/account/state`) stay the source of truth.
 */
export function startOrderUpdatePublisher(options: {
  orders: Pick<OrderService, 'onOrderUpdate' | 'onAccountDelta'>;
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
  const publish = (userId: string, event: OrderUpdateEvent | AccountDeltaEvent) => {
    publisher
      .publish(orderUpdatesChannel(userId), JSON.stringify(event))
      .then(onPublished, onFailed);
  };
  const stopOrders = orders.onOrderUpdate((userId, order) => {
    publish(userId, { v: ORDER_UPDATE_EVENT_VERSION, userId, order });
  });
  const stopDeltas = orders.onAccountDelta((userId, delta) => {
    publish(userId, { v: ACCOUNT_DELTA_EVENT_VERSION, type: 'accountDelta', userId, delta });
  });
  return {
    stop() {
      stopOrders();
      stopDeltas();
    },
  };
}
