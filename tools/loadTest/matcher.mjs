#!/usr/bin/env node
// Matcher benchmark (NSTOCK-0370, spec market-data-and-matching §10 and §11). One process holds
// 1,00,000 resting LIMIT orders and 10,000 trailing stops over 500 instruments in the matcher's
// order books (`OrderBook`, packages/paperEngine) and ticks every instrument every 250 ms on a
// random walk, which is 2,000 ticks a second. For each tick it records the time the book takes,
// and the heap entries the tick read against what it acted on. Crossed orders and triggered stops
// are replaced at the new price, so the book stays full. Method and results:
// docs/runbooks/load-test.md, "Matcher".
//
//   npm run build -w @nthstock/paperEngine
//   node tools/loadTest/matcher.mjs --duration 30
//   node tools/loadTest/matcher.mjs --duration 30 --redis redis://127.0.0.1:6379
//
// With --redis it also sends each crossing tick's fill requests (one `MatcherFill` per user, as
// apps/matcher does) to a throwaway stream and reads them back in a consumer group on a second
// connection, as apps/api does, so the result includes the hop to the process that commits.
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';
import { OrderBook } from '../../packages/paperEngine/dist/index.js';

const FLAGS = [
  'instruments',
  'orders',
  'stops',
  'users',
  'tick-ms',
  'duration',
  'redis',
  'seed',
  'sigma',
];
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i];
  const name = flag.replace(/^--/, '');
  const value = process.argv[i + 1];
  if (!flag.startsWith('--') || !FLAGS.includes(name)) {
    throw new Error(`unknown flag ${flag}; expected one of --${FLAGS.join(', --')}`);
  }
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
  args.set(name, value);
}
/** A numeric flag, refused unless it is a finite number above `min`. */
const numberArg = (name, fallback, min = 0) => {
  const value = Number(args.get(name) ?? fallback);
  if (!Number.isFinite(value) || value <= min)
    throw new Error(`--${name} must be a number above ${String(min)}`);
  return value;
};
const INSTRUMENTS = numberArg('instruments', 500);
const ORDERS = numberArg('orders', 100_000);
const STOPS = numberArg('stops', 10_000, -1);
const USERS = numberArg('users', 10_000);
const TICK_MS = numberArg('tick-ms', 250);
const DURATION_S = numberArg('duration', 30);
const REDIS_URL = args.get('redis') ?? null;
const SEED = numberArg('seed', 42, -1);

// A seeded generator, so two runs place the same book and walk the same prices.
let state = SEED >>> 0;
const random = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};
const TICK_SIZE = 5; // paise
const onTick = (paise) => Math.max(TICK_SIZE, Math.round(paise / TICK_SIZE) * TICK_SIZE);

const books = [];
const prices = [];
let nextId = 0;
const userOf = () => `u${String(Math.floor(random() * USERS))}`;

/** A LIMIT order within 2% of the price, on the side that rests (a BUY below, a SELL above). */
function restingOrder(token) {
  const side = random() < 0.5 ? 'BUY' : 'SELL';
  const gap = 1 + random() * 0.02;
  const price = onTick(side === 'BUY' ? prices[token] / gap : prices[token] * gap);
  nextId += 1;
  return { orderId: `o${String(nextId)}`, userId: userOf(), version: 1, side, price };
}

/** A trailing stop on a long position, trailing 1% to 3% under the price. */
function restingStop(token) {
  const amount = onTick(prices[token] * (0.01 + random() * 0.02));
  nextId += 1;
  return {
    stopId: `s${String(nextId)}`,
    userId: userOf(),
    version: 1,
    state: {
      status: 'TRAILING',
      direction: 'LONG',
      trail: { unit: 'AMOUNT', amount },
      activationPrice: null,
      watermarkPrice: prices[token],
      stopPrice: prices[token] - amount,
    },
  };
}

for (let token = 0; token < INSTRUMENTS; token += 1) {
  books.push(new OrderBook());
  prices.push(onTick(100_00 + random() * 4_900_00)); // ₹100 to ₹5,000
}
const loadStart = performance.now();
for (let i = 0; i < ORDERS; i += 1) {
  const token = i % INSTRUMENTS;
  books[token].upsertOrder(restingOrder(token));
}
for (let i = 0; i < STOPS; i += 1) {
  const token = i % INSTRUMENTS;
  books[token].upsertStop(restingStop(token));
}
const loadMs = performance.now() - loadStart;

/**
 * Each tick's price: a GBM step of 0.25% (about 2.7% over a 30 s run, some 40 times a real
 * stock's volatility), so a short run crosses many orders and moves many stops.
 */
const SIGMA = numberArg('sigma', 0.0025);
function walk(token) {
  const z = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  // A few ticks jump, as news does, so some ticks cross many orders at once.
  const jump = random() < 0.001 ? (random() - 0.5) * 0.04 : 0;
  prices[token] = onTick(prices[token] * Math.exp(SIGMA * z + jump));
  return prices[token];
}

/** The p-th percentile, or null for an empty sample, so a lost sample never reads as 0 ms. */
const percentile = (values, p) => {
  if (values.length === 0) return null;
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const summary = (values) => ({
  p50: percentile(values, 50),
  p95: percentile(values, 95),
  p99: percentile(values, 99),
  max: percentile(values, 100),
});

// The fill hop: apps/matcher's XADD and apps/api's XREADGROUP, on two connections.
const stream = `bench:matcher:fills:${String(process.pid)}`;
let writer = null;
let reader = null;
const sentAt = new Map();
const hopMs = [];
let readerDone = Promise.resolve();
let stopping = false;
// Failed sends and reads are counted, and any of them fails the run: a hop sample with holes in
// it would otherwise print as a good result.
let sendErrors = 0;
let readErrors = 0;
let lastError = null;
if (REDIS_URL) {
  writer = new Redis(REDIS_URL, { maxRetriesPerRequest: 2 });
  reader = new Redis(REDIS_URL, { maxRetriesPerRequest: 2 });
  await writer.call('XGROUP', 'CREATE', stream, 'api', '$', 'MKSTREAM');
  readerDone = (async () => {
    while (!stopping) {
      let reply;
      try {
        reply = await reader.call(
          'XREADGROUP',
          'GROUP',
          'api',
          'bench',
          'COUNT',
          '500',
          'BLOCK',
          '200',
          'STREAMS',
          stream,
          '>',
        );
      } catch (error) {
        readErrors += 1;
        lastError = String(error);
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      if (!reply) continue;
      // RESP2 pairs or a RESP3 map, as `streamsOf` in apps/api reads them.
      const entries = Array.isArray(reply[0]) ? reply[0][1] : reply[1];
      const now = performance.now();
      const ids = [];
      for (const [id, fields] of entries) {
        ids.push(id);
        const key = JSON.parse(fields[1]).key;
        const at = sentAt.get(key);
        if (at !== undefined) {
          hopMs.push(now - at);
          sentAt.delete(key);
        }
      }
      if (ids.length > 0) {
        await reader.call('XACK', stream, 'api', ...ids).catch((error) => {
          readErrors += 1;
          lastError = String(error);
        });
      }
    }
  })();
}

const tickMs = [];
const crossingTickMs = [];
let ticks = 0;
let read = 0;
let acted = 0;
let crossedTotal = 0;
let triggeredTotal = 0;
let movedTotal = 0;
let requests = 0;
let maxReadInTick = 0;
const lagMs = [];

/** One round: every instrument ticks once, spread over the tick interval in slices. */
const SLICES = 25;
const perSlice = Math.ceil(INSTRUMENTS / SLICES);
const sliceMs = TICK_MS / SLICES;
const runStart = performance.now();
const endAt = runStart + DURATION_S * 1_000;
let slice = 0;

await new Promise((resolve) => {
  const next = () => {
    const due = runStart + slice * sliceMs;
    const now = performance.now();
    if (now >= endAt) {
      resolve();
      return;
    }
    lagMs.push(Math.max(0, now - due));
    const from = (slice % SLICES) * perSlice;
    for (let token = from; token < Math.min(INSTRUMENTS, from + perSlice); token += 1) {
      const ltp = walk(token);
      const book = books[token];
      const started = performance.now();
      const result = book.tick(ltp);
      // What apps/matcher does next: one fill request per user with a crossed order or a stop.
      const users = new Set();
      for (const order of result.crossed) users.add(order.userId);
      for (const stop of result.triggered) users.add(stop.userId);
      const fills = [...users].map((userId) => ({
        v: 1,
        userId,
        token,
        ltp,
        ts: new Date().toISOString(),
        orderIds: result.crossed.filter((o) => o.userId === userId).map((o) => o.orderId),
        stopIds: result.triggered.filter((s) => s.userId === userId).map((s) => s.stopId),
      }));
      const took = performance.now() - started;
      tickMs.push(took);
      if (fills.length > 0) crossingTickMs.push(took);
      ticks += 1;
      read += result.read;
      maxReadInTick = Math.max(maxReadInTick, result.read);
      const actedNow = result.crossed.length + result.triggered.length + result.moved.length;
      acted += actedNow;
      crossedTotal += result.crossed.length;
      triggeredTotal += result.triggered.length;
      movedTotal += result.moved.length;
      requests += fills.length;
      if (writer) {
        for (const fill of fills) {
          const key = `${String(token)}:${String(ticks)}:${fill.userId}`;
          sentAt.set(key, started);
          writer
            .xadd(stream, 'MAXLEN', '~', 100_000, '*', 'fill', JSON.stringify({ ...fill, key }))
            .catch((error) => {
              sendErrors += 1;
              lastError = String(error);
            });
        }
      }
      // Fresh orders and stops replace the ones that left, so the book stays full.
      for (let i = 0; i < result.crossed.length; i += 1) book.upsertOrder(restingOrder(token));
      for (let i = 0; i < result.triggered.length; i += 1) book.upsertStop(restingStop(token));
    }
    slice += 1;
    setTimeout(next, Math.max(0, runStart + slice * sliceMs - performance.now()));
  };
  next();
});
const runS = (performance.now() - runStart) / 1_000;

if (writer && reader) {
  // Give the reader a moment to drain the last requests, then clean up.
  const drainUntil = performance.now() + 2_000;
  while (sentAt.size > 0 && performance.now() < drainUntil) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  stopping = true;
  // The reader's BLOCK is 200 ms, so it stops well inside 5 s unless its connection is gone.
  const READER_STOP_MS = 5_000;
  const stopped = await Promise.race([
    readerDone.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), READER_STOP_MS)),
  ]);
  if (!stopped) {
    readErrors += 1;
    lastError = `the reader did not stop within ${String(READER_STOP_MS)} ms`;
  }
  await writer.del(stream).catch(() => undefined);
  writer.disconnect();
  reader.disconnect();
}

const resting = books.reduce(
  (sum, book) => ({ orders: sum.orders + book.size.orders, stops: sum.stops + book.size.stops }),
  { orders: 0, stops: 0 },
);
const result = {
  at: new Date().toISOString(),
  machine: `${String(cpus().length)} vCPU ${cpus()[0]?.model ?? ''}`.trim(),
  node: process.version,
  setup: {
    instruments: INSTRUMENTS,
    orders: ORDERS,
    stops: STOPS,
    users: USERS,
    tickMs: TICK_MS,
    durationS: DURATION_S,
    seed: SEED,
  },
  loadMs: Math.round(loadMs),
  restingAtEnd: resting,
  ticks,
  ticksPerSecond: Math.round(ticks / runS),
  tickBookMs: summary(tickMs),
  crossingTickBookMs: summary(crossingTickMs),
  schedulerLagMs: summary(lagMs),
  readPerTick: {
    mean: read / ticks,
    max: maxReadInTick,
    // What a matcher that walked every resting order and stop on every tick would read.
    fullWalk: (ORDERS + STOPS) / INSTRUMENTS,
  },
  read,
  acted,
  stale: read - acted,
  crossed: crossedTotal,
  triggered: triggeredTotal,
  moved: movedTotal,
  fillRequests: requests,
  ...(REDIS_URL
    ? {
        tickToRequestReadMs: summary(hopMs),
        requestsRead: hopMs.length,
        // Requests sent but never read back in the drain: any of these fails the run.
        lost: sentAt.size,
        sendErrors,
        readErrors,
        ...(lastError ? { lastError } : {}),
      }
    : {}),
};

const round = (value) => (typeof value === 'number' ? Math.round(value * 1_000) / 1_000 : value);
const rounded = JSON.parse(JSON.stringify(result, (_key, value) => round(value)));
process.stdout.write(`${JSON.stringify(rounded, null, 2)}\n`);
const dir = fileURLToPath(new URL('./results/', import.meta.url));
mkdirSync(dir, { recursive: true });
const day = result.at.slice(0, 10);
const file = `${dir}${day}-matcher-orders${String(ORDERS)}-instruments${String(INSTRUMENTS)}${REDIS_URL ? '-redis' : ''}.json`;
writeFileSync(file, `${JSON.stringify(rounded, null, 2)}\n`);
process.stdout.write(`Saved ${file}\n`);
if (REDIS_URL && (result.requestsRead !== requests || sendErrors > 0 || readErrors > 0)) {
  process.stderr.write(
    `The fill hop is incomplete: ${String(result.requestsRead)} of ${String(requests)} requests read, ${String(sendErrors)} send and ${String(readErrors)} read errors.\n`,
  );
  process.exitCode = 1;
}
