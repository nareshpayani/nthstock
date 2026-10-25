import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WS_PROTOCOL_VERSION } from '@nthstock/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createRealtimeServer, WS_PATH, type RealtimeServer } from './app.js';
import { createRedisStreamQuoteFeed } from './feeds/streamFeed.js';
import { connectAuthed, testAuthenticator } from './test/auth.js';
import { describeSample, percentile, sampleTickToScreen } from './test/latency.js';
import { describeWithRedis, startTestRedis, type TestRedis } from './test/testRedis.js';
import type { TestClient } from './test/wsTestClient.js';

/**
 * NSTOCK-0355: tick-to-screen across the three processes of the quote service (spec
 * market-data-and-matching §4 and §10): apps/quotes ticks and writes `XADD` batches every 250 ms,
 * apps/realtime follows the tick streams and fans out, and a WebSocket client decodes the binary
 * frames as the browser does, plus one frame to paint. CLAUDE.md §3 target: p95 under 500 ms.
 *
 * apps/quotes runs from its build (`node apps/quotes/dist/server.js`) with the mock market forced
 * open. Runs with `npm run test:latency`, beside the T-171 test that measures the in-process tick
 * pump, so the two paths can be compared on one machine.
 */

const QUOTES_SERVER = fileURLToPath(new URL('../../quotes/dist/server.js', import.meta.url));
const SYMBOLS = ['RELIANCE', 'HDFCBANK', 'TCS', 'INFY', 'ICICIBANK', 'SBIN', 'ITC', 'LT'];
const MEASURE_MS = 10_000;
const TARGET_P95_MS = 500;

describeWithRedis('tick-to-screen: apps/quotes → Redis Streams → apps/realtime → client', () => {
  let redis: TestRedis | null = null;
  let unavailable: string | null = null;
  let quotes: ChildProcess | null = null;
  let server: RealtimeServer | null = null;
  let client: TestClient | null = null;

  beforeAll(async () => {
    if (!existsSync(QUOTES_SERVER)) {
      throw new Error(
        `${QUOTES_SERVER} is missing: build apps/quotes first (npx turbo run build --filter=@nthstock/quotes).`,
      );
    }
    try {
      redis = await startTestRedis();
    } catch (error) {
      unavailable = error instanceof Error ? error.message : String(error);
      process.stderr.write(`\n[quotes-to-screen] skipped, no Redis: ${unavailable}\n`);
      return;
    }
    quotes = spawn(process.execPath, [QUOTES_SERVER], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        REDIS_URL: redis.url,
        SHARDS: '1',
        SHARD: '0',
        MOCK_MARKET_ALWAYS_OPEN: 'true',
      },
      stdio: 'ignore',
    });
    const feed = createRedisStreamQuoteFeed({ url: redis.url, shards: 1, blockMs: 1_000 });
    await feed.ready();
    server = createRealtimeServer({ authenticate: testAuthenticator(), feed });
    const wsPort = await server.listen(0, '127.0.0.1');
    client = await connectAuthed(`ws://127.0.0.1:${String(wsPort)}${WS_PATH}`);
    client.send({ v: WS_PROTOCOL_VERSION, type: 'subscribe', symbols: SYMBOLS });
  }, 180_000);

  afterAll(async () => {
    client?.close();
    await server?.close();
    if (quotes && quotes.exitCode === null) {
      const exited = new Promise((resolve) => quotes?.once('exit', resolve));
      quotes.kill('SIGTERM');
      await exited;
    }
    await redis?.stop();
  }, 60_000);

  it(`delivers quotes with tick-to-screen p95 under ${String(TARGET_P95_MS)} ms`, async (context) => {
    if (unavailable || !client) {
      context.skip();
      return;
    }
    expect(quotes?.exitCode, 'apps/quotes exited early').toBeNull();
    const sample = await sampleTickToScreen(client, MEASURE_MS);
    const { latencies, seen } = sample;
    process.stdout.write(describeSample('quotes-to-screen', sample));
    expect(latencies.length).toBeGreaterThanOrEqual(SYMBOLS.length * 3);
    expect([...seen].sort()).toEqual([...SYMBOLS].sort());
    expect(percentile(latencies, 95)).toBeLessThan(TARGET_P95_MS);
  }, 30_000);
});
