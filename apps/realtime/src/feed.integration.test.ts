import { TICK_BATCH_VERSION, WS_PROTOCOL_VERSION, type Quote } from '@nthstock/contracts';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createRealtimeServer, WS_PATH } from './app.js';
import { createRedisQuoteFeed } from './feed.js';
import { testQuote } from './test/quotes.js';
import {
  describeWithRedis,
  startTestRedis,
  uniqueChannel,
  type TestRedis,
} from './test/testRedis.js';
import { connectTestClient } from './test/wsTestClient.js';

describeWithRedis('Redis feed to WebSocket clients (integration)', () => {
  let redis: TestRedis | undefined;
  let publisher: Redis;

  beforeAll(async () => {
    redis = await startTestRedis();
    publisher = new Redis(redis.url);
  }, 180_000);

  afterAll(async () => {
    await publisher?.quit();
    await redis?.stop();
  });

  it('fans quotes from the ticks channel out to subscribed clients only', async () => {
    const channel = uniqueChannel('test:ticks');
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const feed = createRedisQuoteFeed({ url: redis?.url ?? '', channel, logger });
    await feed.ready();
    const server = createRealtimeServer({ feed });
    const port = await server.listen(0, '127.0.0.1');
    const client = await connectTestClient(`ws://127.0.0.1:${port}${WS_PATH}`);
    client.send({ v: WS_PROTOCOL_VERSION, type: 'subscribe', symbols: ['INFY'] });
    await client.drain();

    const publish = (quotes: Quote[]) =>
      publisher.publish(channel, JSON.stringify({ v: TICK_BATCH_VERSION, quotes }));
    await publisher.publish(channel, 'not json');
    await publisher.publish(channel, JSON.stringify({ v: 99, quotes: [] }));
    await publish([testQuote('TCS', 300_000)]);
    await publish([testQuote('TCS', 300_100), testQuote('INFY', 150_000)]);

    const frame = await client.next();
    expect(frame).toMatchObject({ kind: 'json', message: { type: 'quotes' } });
    const symbols =
      frame.kind === 'json' && frame.message.type === 'quotes'
        ? frame.message.quotes.map((q) => q.symbol)
        : [];
    expect(symbols).toEqual(['INFY']);
    expect(await client.drain()).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith('Dropped a malformed tick batch', { channel });

    client.close();
    await server.close();
  });
});
