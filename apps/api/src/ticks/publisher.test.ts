import { describe, expect, it } from 'vitest';
import { createMemoryPublisher, createRedisPublisher } from './publisher.js';

describe('createRedisPublisher', () => {
  it('fails fast while Redis is unreachable instead of queueing ticks, and logs once', async () => {
    const warnings: string[] = [];
    // Nothing listens on port 1; ioredis retries in the background until closed.
    const publisher = createRedisPublisher('redis://127.0.0.1:1', {
      info: () => undefined,
      warn: (message) => warnings.push(message),
    });
    await expect(publisher.publish('x', 'y')).rejects.toThrow();
    await expect(publisher.publish('x', 'y')).rejects.toThrow();
    await publisher.close();
    expect(warnings.length).toBeLessThanOrEqual(1);
  });
});

describe('createMemoryPublisher', () => {
  it('records messages, fails on demand and reports closing', async () => {
    const publisher = createMemoryPublisher();
    await publisher.publish('a', '1');
    publisher.fail(new Error('down'));
    await expect(publisher.publish('a', '2')).rejects.toThrow('down');
    expect(publisher.messages).toEqual([{ channel: 'a', message: '1' }]);
    expect(publisher.closed).toBe(false);
    await publisher.close();
    expect(publisher.closed).toBe(true);
  });
});
