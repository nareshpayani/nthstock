import { type Quote, type TickStreamEntry } from '@nthstock/contracts';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { testQuote } from '../test/quotes.js';
import {
  describeWithRedis,
  startTestRedis,
  uniqueChannel,
  type TestRedis,
} from '../test/testRedis.js';
import { createRedisStreamQuoteFeed, type RedisStreamQuoteFeed } from './streamFeed.js';

describeWithRedis('tick stream feed on real Redis (integration, NSTOCK-0353)', () => {
  let server: TestRedis | undefined;
  let redis: Redis;
  const feeds: RedisStreamQuoteFeed[] = [];

  beforeAll(async () => {
    server = await startTestRedis();
    redis = new Redis(server.url);
  }, 180_000);

  afterEach(async () => {
    for (const feed of feeds.splice(0)) await feed.close();
  });

  afterAll(async () => {
    await redis.quit();
    await server?.stop();
  });

  /** Keys of one test; writes entries as apps/quotes does (stream entry plus snapshot). */
  function shard() {
    const prefix = uniqueChannel('test');
    const stream = `${prefix}:ticks`;
    const snapshot = `${prefix}:last`;
    const write = async (seq: number, quotes: Quote[], { toStream = true } = {}) => {
      const entry: TickStreamEntry = { v: 1, shard: 0, seq, quotes };
      const multi = redis.multi();
      if (toStream) multi.xadd(stream, '*', 'batch', JSON.stringify(entry));
      multi.hset(snapshot, ...quotes.flatMap((q) => [String(q.token), JSON.stringify(q)]));
      await multi.exec();
    };
    const feed = () => {
      const started = createRedisStreamQuoteFeed({
        url: server?.url ?? '',
        shards: 1,
        streamKey: () => stream,
        snapshotKey: () => snapshot,
        blockMs: 100,
      });
      feeds.push(started);
      return started;
    };
    return { stream, write, feed };
  }

  /** Collects the LTP each token last had in the feed's batches. */
  function prices(feed: RedisStreamQuoteFeed) {
    const seen = new Map<number, number>();
    feed.onQuotes((quotes) => {
      for (const quote of quotes) seen.set(quote.token, quote.ltp);
    });
    return seen;
  }

  const until = async (check: () => boolean) => {
    for (let tries = 0; tries < 100 && !check(); tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(check()).toBe(true);
  };

  const q = (token: number, ltp: number) => testQuote(`S${String(token)}`, ltp, { token });

  it('starts from the snapshot, then follows the stream', async () => {
    const { write, feed } = shard();
    await write(1, [q(1, 100), q(2, 200)]);
    const started = feed();
    const seen = prices(started);
    await started.ready();
    await until(() => seen.get(1) === 100 && seen.get(2) === 200);

    await write(2, [q(1, 110)]);
    await until(() => seen.get(1) === 110);
  });

  it('re-reads the snapshot when entries were missed, so no price stays stale', async () => {
    const { write, feed } = shard();
    await write(1, [q(1, 100), q(2, 200)]);
    const started = feed();
    const seen = prices(started);
    await started.ready();
    // Entry 2 moves token 2 but never reaches the stream (trimmed or lost); entry 3 does.
    await write(2, [q(2, 250)], { toStream: false });
    await write(3, [q(1, 130)]);
    await until(() => seen.get(1) === 130 && seen.get(2) === 250);
  });

  it('carries on after the writer restarts and numbers from 1 again', async () => {
    const { write, feed } = shard();
    await write(7, [q(1, 100)]);
    const started = feed();
    const seen = prices(started);
    await started.ready();
    await write(1, [q(1, 90), q(3, 300)]);
    await until(() => seen.get(1) === 90 && seen.get(3) === 300);
  });

  it('drops an entry that does not parse and keeps reading', async () => {
    const { stream, write, feed } = shard();
    const started = feed();
    const seen = prices(started);
    await started.ready();
    await redis.xadd(stream, '*', 'batch', '{not json');
    await write(1, [q(4, 400)]);
    await until(() => seen.get(4) === 400);
  });
});
