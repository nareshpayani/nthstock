import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { WS_PROTOCOL_VERSION, createQuoteFrameDecoder, type Quote } from '@nthstock/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createRealtimeServer, WS_PATH, type RealtimeServer } from './app.js';
import { createRedisQuoteFeed } from './feeds/feed.js';
import { connectAuthed, testAuthenticator } from './test/auth.js';
import { describeWithRedis, startTestRedis, type TestRedis } from './test/testRedis.js';
import type { TestClient } from './test/wsTestClient.js';

/**
 * T-171: tick-to-screen, end to end over a real Redis (Testcontainers, or REDIS_TEST_URL).
 *
 * apps/api runs as its own process from its build (`node apps/api/dist/server.js`, which
 * `npm run test:latency` expects built) with the mock market forced open: its tick pump publishes every tick to
 * Redis. apps/realtime runs here and fans them out; a WebSocket client subscribes the way the
 * browser does and decodes the binary frames with the same decoder (`createQuoteFrameDecoder`).
 *
 * Latency per quote = receive time − the quote's `ts` (stamped by the mock adapter when it ticks;
 * both processes share this machine's clock). The web app then paints on the next animation frame
 * (the quote store batches per frame, CLAUDE.md §4), so one 60 Hz frame is added: that is
 * tick-to-screen. CLAUDE.md §3 target: under 500 ms; the p95 is asserted.
 *
 * Runs on its own (`npm run test:latency`), not in `npm test`: wall-clock numbers taken beside
 * other suites under coverage measure the runner, not the pipeline. Without Docker (and without
 * REDIS_TEST_URL) it is skipped with a printed reason; CI runs it in the api-mode job.
 */

const API_SERVER = fileURLToPath(new URL('../../api/dist/server.js', import.meta.url));
const SYMBOLS = ['RELIANCE', 'HDFCBANK', 'TCS', 'INFY', 'ICICIBANK', 'SBIN', 'ITC', 'LT'];
const MEASURE_MS = 10_000;
/** One frame at 60 Hz: the quote store paints on the next animation frame. */
const FRAME_MS = 1000 / 60;
const TARGET_P95_MS = 500;

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });

async function waitForHealth(url: string, api: ChildProcess, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (api.exitCode !== null) throw new Error(`apps/api exited with ${String(api.exitCode)}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`apps/api did not answer ${url} within ${String(timeoutMs)} ms`);
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.NaN;
}

describeWithRedis('tick-to-screen: apps/api → Redis → apps/realtime → client (T-171)', () => {
  let redis: TestRedis | null = null;
  let unavailable: string | null = null;
  let api: ChildProcess | null = null;
  let server: RealtimeServer | null = null;
  let client: TestClient | null = null;

  beforeAll(async () => {
    if (!existsSync(API_SERVER)) {
      throw new Error(
        `${API_SERVER} is missing: build apps/api first (npx turbo run build --filter=@nthstock/api).`,
      );
    }
    try {
      redis = await startTestRedis();
    } catch (error) {
      unavailable = error instanceof Error ? error.message : String(error);
      process.stderr.write(`\n[tick-to-screen] skipped, no Redis: ${unavailable}\n`);
      return;
    }
    const feed = createRedisQuoteFeed({ url: redis.url });
    await feed.ready();
    server = createRealtimeServer({ authenticate: testAuthenticator(), feed });
    const wsPort = await server.listen(0, '127.0.0.1');

    const apiPort = await freePort();
    api = spawn(process.execPath, [API_SERVER], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: String(apiPort),
        REDIS_URL: redis.url,
        MOCK_MARKET_ALWAYS_OPEN: 'true',
        JWT_SECRET: '',
        ENABLE_TEST_CONTROLS: 'false',
        DEMO_SEED: 'false',
      },
      stdio: 'ignore',
    });
    await waitForHealth(`http://127.0.0.1:${String(apiPort)}/v1/health`, api);

    client = await connectAuthed(`ws://127.0.0.1:${String(wsPort)}${WS_PATH}`);
    client.send({ v: WS_PROTOCOL_VERSION, type: 'subscribe', symbols: SYMBOLS });
  }, 180_000);

  afterAll(async () => {
    client?.close();
    await server?.close();
    if (api && api.exitCode === null) {
      const exited = new Promise((resolve) => api?.once('exit', resolve));
      api.kill('SIGTERM');
      await exited;
    }
    await redis?.stop();
  }, 60_000);

  it(`delivers quotes with tick-to-screen p95 under ${String(TARGET_P95_MS)} ms`, async (context) => {
    if (unavailable || !client) {
      context.skip();
      return;
    }
    const decoder = createQuoteFrameDecoder();
    const latencies: number[] = [];
    const seen = new Set<string>();
    const until = Date.now() + MEASURE_MS;
    while (Date.now() < until) {
      const frame = await Promise.race([
        client.next(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), until - Date.now())),
      ]);
      if (!frame) break;
      const receivedAt = Date.now();
      let quotes: Quote[] = [];
      if (frame.kind === 'binary') quotes = decoder.decode(frame.data);
      else if (frame.message.type === 'instruments') decoder.learn(frame.message.instruments);
      else if (frame.message.type === 'quotes') quotes = frame.message.quotes;
      for (const quote of quotes) {
        seen.add(quote.symbol);
        latencies.push(receivedAt - Date.parse(quote.ts) + FRAME_MS);
      }
    }

    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const max = Math.max(...latencies);
    process.stdout.write(
      `\n[tick-to-screen] ${String(latencies.length)} quotes, ${String(seen.size)} symbols: ` +
        `p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${max.toFixed(1)} ms\n`,
    );
    // The mock market ticks every symbol once a second, so 10 s gives dozens of samples.
    expect(latencies.length).toBeGreaterThanOrEqual(SYMBOLS.length * 3);
    expect([...seen].sort()).toEqual([...SYMBOLS].sort());
    expect(p95).toBeLessThan(TARGET_P95_MS);
  }, 30_000);

  it('computes percentiles by rank', () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([], 95)).toBeNaN();
  });
});
