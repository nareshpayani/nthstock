import { OrderUpdateEvent, orderUpdatesChannel, type Order } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { createMemoryPublisher } from '../../ticks/publisher.js';
import type { OrderUpdateListener } from './service.js';
import { startOrderUpdatePublisher } from './updatePublisher.js';

const order: Order = {
  id: 'pe_1',
  clientOrderId: null,
  token: 1594,
  symbol: 'INFY',
  exchange: 'NSE',
  side: 'BUY',
  type: 'MARKET',
  product: 'DELIVERY',
  qty: 1,
  price: null,
  filledQty: 1,
  avgFillPrice: 150_000,
  status: 'EXECUTED',
  statusReason: null,
  placedAt: '2026-09-28T04:30:00.000Z',
  updatedAt: '2026-09-28T04:30:00.000Z',
};

function fakeOrders() {
  const listeners = new Set<OrderUpdateListener>();
  return {
    onOrderUpdate(listener: OrderUpdateListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (userId: string, next: Order) => {
      for (const listener of listeners) listener(userId, next);
    },
    listeners,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('order update publisher (T-133)', () => {
  it("publishes each update on its user's own channel as an OrderUpdateEvent", async () => {
    const orders = fakeOrders();
    const publisher = createMemoryPublisher();
    const log = { info: () => undefined, warn: () => undefined };
    const running = startOrderUpdatePublisher({ orders, publisher, log });

    orders.emit('usr_a', order);
    orders.emit('usr_b', { ...order, id: 'pe_2' });
    await flush();
    expect(publisher.messages.map((m) => m.channel)).toEqual([
      orderUpdatesChannel('usr_a'),
      orderUpdatesChannel('usr_b'),
    ]);
    const first = OrderUpdateEvent.parse(JSON.parse(publisher.messages[0]?.message ?? ''));
    expect(first).toEqual({ v: 1, userId: 'usr_a', order });

    running.stop();
    expect(orders.listeners.size).toBe(0);
  });

  it('logs a failing Redis once per outage and once on recovery', async () => {
    const orders = fakeOrders();
    const publisher = createMemoryPublisher();
    const warnings: string[] = [];
    const infos: string[] = [];
    startOrderUpdatePublisher({
      orders,
      publisher,
      log: { info: (m) => infos.push(m), warn: (m) => warnings.push(m) },
    });

    publisher.fail(new Error('down'));
    orders.emit('usr_a', order);
    orders.emit('usr_a', order);
    await flush();
    publisher.fail(null);
    orders.emit('usr_a', order);
    orders.emit('usr_a', order);
    await flush();

    expect(warnings).toEqual(['Order update publishing failed: down']);
    expect(infos).toEqual(['Order update publishing recovered']);
  });
});
