import { describe, expect, it, vi } from 'vitest';
import {
  NOTIFICATION_EVENT_VERSION,
  ORDER_UPDATE_EVENT_VERSION,
  notifyChannel,
  orderUpdatesChannel,
} from '@nthstock/contracts';
import { createMemoryOrderFeed, parseNotifyMessage, parseUserChannelMessage } from './orderFeed.js';
import { testAccountDelta, testNotification, testOrder } from '../test/orders.js';

describe('createMemoryOrderFeed', () => {
  it('delivers only watched users, counting watchers per user', async () => {
    const feed = createMemoryOrderFeed();
    const listener = vi.fn();
    const detach = feed.onOrderUpdate(listener);

    feed.emit('usr_a', testOrder('o1'));
    const first = feed.watch('usr_a');
    const second = feed.watch('usr_a');
    feed.emit('usr_a', testOrder('o2'));
    first();
    first(); // releasing twice counts once
    expect(feed.watching('usr_a')).toBe(true);
    feed.emit('usr_a', testOrder('o3'));
    second();
    expect(feed.watching('usr_a')).toBe(false);
    feed.emit('usr_a', testOrder('o4'));

    expect(
      listener.mock.calls.map(
        ([userId, order]) => `${String(userId)}:${String((order as { id: string }).id)}`,
      ),
    ).toEqual(['usr_a:o2', 'usr_a:o3']);
    detach();
    feed.watch('usr_b');
    feed.emit('usr_b', testOrder('o5'));
    expect(listener).toHaveBeenCalledTimes(2);
    await feed.close();
    expect(feed.watching('usr_b')).toBe(false);
  });
});

describe('createMemoryOrderFeed account deltas (NSTOCK-0368)', () => {
  it('delivers deltas to delta listeners only, and only while the user is watched', async () => {
    const feed = createMemoryOrderFeed();
    const orders = vi.fn();
    const deltas = vi.fn();
    feed.onOrderUpdate(orders);
    const detach = feed.onAccountDelta(deltas);

    feed.emitDelta('usr_a', testAccountDelta(1));
    const unwatch = feed.watch('usr_a');
    feed.emitDelta('usr_a', testAccountDelta(2));
    feed.emitDelta('usr_b', testAccountDelta(3));
    unwatch();
    feed.emitDelta('usr_a', testAccountDelta(4));

    expect(deltas.mock.calls).toEqual([['usr_a', testAccountDelta(2)]]);
    expect(orders).not.toHaveBeenCalled();
    detach();
    feed.watch('usr_a');
    feed.emitDelta('usr_a', testAccountDelta(5));
    expect(deltas).toHaveBeenCalledTimes(1);
    await feed.close();
  });
});

describe('parseUserChannelMessage (NSTOCK-0368)', () => {
  const channel = orderUpdatesChannel('usr_a');
  const delta = { v: 1, type: 'accountDelta', userId: 'usr_a', delta: testAccountDelta(9) };
  const update = { v: ORDER_UPDATE_EVENT_VERSION, userId: 'usr_a', order: testOrder('o1') };

  it('reads an account delta and an order update', () => {
    expect(parseUserChannelMessage(channel, JSON.stringify(delta))).toEqual(delta);
    expect(parseUserChannelMessage(channel, JSON.stringify(update))).toEqual(update);
  });

  it('drops malformed events and events for another user', () => {
    const drops = [
      'not json',
      JSON.stringify({ ...delta, userId: 'usr_b' }),
      JSON.stringify({ ...delta, delta: { ...delta.delta, orders: [{ id: 'o_bad' }] } }),
      JSON.stringify({ ...delta, v: 2 }),
      JSON.stringify({ v: 1, type: 'accountDelta', userId: 'usr_a' }),
    ];
    for (const message of drops) expect(parseUserChannelMessage(channel, message)).toBeNull();
    expect(parseUserChannelMessage('nthstock:other:usr_a', JSON.stringify(delta))).toBeNull();
  });
});

describe('notifications on the feed (NSTOCK-0381)', () => {
  it('delivers notifications to notification listeners only while the user is watched', () => {
    const feed = createMemoryOrderFeed();
    const listener = vi.fn();
    feed.onNotification(listener);
    feed.emitNotification('usr_a', { notification: testNotification('1') });
    const unwatch = feed.watch('usr_a');
    feed.emitNotification('usr_a', { notification: testNotification('2') });
    unwatch();
    feed.emitNotification('usr_a', { notification: testNotification('3') });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('usr_a', { notification: testNotification('2') });
  });

  it("parses a notify message only when it is the channel's user's and well formed", () => {
    const channel = notifyChannel('usr_a');
    const event = {
      v: NOTIFICATION_EVENT_VERSION,
      userId: 'usr_a',
      notification: testNotification('7'),
    };

    expect(parseNotifyMessage(channel, JSON.stringify(event))).toEqual(event);
    expect(parseNotifyMessage(channel, JSON.stringify({ ...event, userId: 'usr_b' }))).toBeNull();
    expect(parseNotifyMessage(channel, '{')).toBeNull();
    expect(parseNotifyMessage(channel, JSON.stringify({ ...event, notification: {} }))).toBeNull();
    expect(parseNotifyMessage(orderUpdatesChannel('usr_a'), JSON.stringify(event))).toBeNull();
  });
});
