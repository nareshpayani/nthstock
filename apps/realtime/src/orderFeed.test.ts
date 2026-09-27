import { describe, expect, it, vi } from 'vitest';
import { createMemoryOrderFeed } from './orderFeed.js';
import { testOrder } from './test/orders.js';

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
