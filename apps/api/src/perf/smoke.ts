import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  AUTH_COOKIES,
  AUTH_CSRF_HEADER,
  CONSENT_POLICY_VERSION,
  TRUSTED_DEVICE_TTL_SEC,
  routes,
} from '@nthstock/contracts';
import { MockMarketDataAdapter, generateSymbolMaster } from '@nthstock/marketData';
import type { Clock } from '@nthstock/utils';
import type { LightMyRequestResponse } from 'fastify';
import { Client } from 'pg';
import { buildApp, type App } from '../app.js';
import { hashToken } from '../modules/auth/index.js';
import {
  normalizeSql,
  queryTimings,
  statementDeltas,
  summarize,
  type PerfSmokeResult,
  type PgStatStatements,
  type StatementRow,
} from './report.js';

/**
 * The local performance smoke (T-243, spec backend-core §13 perf check): seeds users with a PIN
 * and a trusted device, then measures PIN logins and MARKET order acks through the real app on
 * Postgres, with the statements apps/api ran read from pg_stat_statements. `smokeCli.ts` runs it
 * (`npm run perf:smoke`); `report.ts` turns the result into the report and the budgets.
 */

export type PerfSmokeOptions = {
  /** DATABASE_URL: the nthstock_app role, as apps/api connects. */
  databaseUrl: string;
  /**
   * A role that can read pg_stat_statements for the app role (a superuser, or one with
   * pg_read_all_stats); null skips it. The smoke tries CREATE EXTENSION through it first.
   */
  statsUrl: string | null;
  /** Users in the database after seeding (existing perf users are reused). */
  users: number;
  /** Measured PIN logins, and as many MARKET orders (one per logged-in user). */
  samples: number;
  /** Logins and orders before measuring, left out of the numbers. */
  warmup: number;
  /** Requests in flight at once. */
  concurrency: number;
  /** PG_POOL_MAX for the app's pool; default the app's own. */
  poolMax?: number;
  /** Writes progress lines; default nowhere. */
  log?: (line: string) => void;
};

/** The PIN every perf user has (they exist only in a local database). */
export const PERF_PIN = '135790';
const SEED_CONCURRENCY = 16;
const ORDER_TOKENS = 20;
const MAX_FAILURES_REPORTED = 5;

/** Perf users' mobiles, 6100000000 upwards: valid, and clear of the demo, E2E and load-test users. */
export const perfMobile = (index: number) => String(6_100_000_000 + index);
const perfDeviceId = (index: number) => `dev_perfsmoke_${String(index)}`;

/**
 * A clock on a fixed NSE trading day (Monday 28 Sep 2026, 10:00 IST) that moves with real time,
 * so MARKET orders fill whatever day the smoke runs and durations stay real.
 */
export function tradingDayClock(start = '2026-09-28T04:30:00.000Z'): Clock {
  const startMs = Date.parse(start);
  const origin = performance.now();
  return { now: () => new Date(startMs + (performance.now() - origin)) };
}

/** Runs `work(0 … count-1)` with at most `concurrency` in flight; results in index order. */
export async function inPool<T>(
  count: number,
  concurrency: number,
  work: (index: number) => Promise<T>,
): Promise<T[]> {
  const results = new Array<T>(count);
  let next = 0;
  const worker = async () => {
    while (next < count) {
      const index = next;
      next += 1;
      results[index] = await work(index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, count)) }, worker));
  return results;
}

/**
 * A loopback address per virtual user (127.x.y.z), so the per-IP auth limits apply per user as
 * behind a load balancer, not to the whole smoke as one client (as in docs/runbooks/load-test.md).
 */
const addressOf = (index: number) => {
  const n = index + 1;
  return `127.${String((n >> 16) & 255)}.${String((n >> 8) & 255)}.${String(n & 255)}`;
};

type QueryFn = (...args: unknown[]) => unknown;

/**
 * Times every statement any `pg` Client sends, from send to result, until `stop()`. A fallback
 * and cross-check for pg_stat_statements that needs no server setting.
 */
export function recordClientQueries(): { stop(): Map<string, number[]> } {
  // The prototype's overloads cannot be wrapped generically; this keeps the arguments as is.
  const proto = Client.prototype as unknown as { query: QueryFn };
  const original = proto.query;
  const samples = new Map<string, number[]>();
  const record = (text: string, started: number) => {
    const key = normalizeSql(text);
    const list = samples.get(key) ?? [];
    list.push(performance.now() - started);
    samples.set(key, list);
  };
  const textOf = (config: unknown): string | null => {
    if (typeof config === 'string') return config;
    if (typeof config === 'object' && config !== null && 'text' in config) {
      return typeof config.text === 'string' ? config.text : null;
    }
    return null;
  };
  proto.query = function timedQuery(this: unknown, ...args: unknown[]) {
    const text = textOf(args[0]);
    if (text === null) return original.apply(this, args);
    const started = performance.now();
    const last = args.length - 1;
    const callback = args[last];
    if (typeof callback === 'function') {
      args[last] = (...results: unknown[]) => {
        record(text, started);
        return (callback as QueryFn)(...results);
      };
      return original.apply(this, args);
    }
    const result = original.apply(this, args);
    if (result instanceof Promise) {
      result.then(
        () => record(text, started),
        () => record(text, started),
      );
    }
    return result;
  };
  return {
    stop() {
      proto.query = original;
      return samples;
    },
  };
}

type StatementsReader = { snapshot(): Promise<StatementRow[]>; close(): Promise<void> };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Opens pg_stat_statements for the app role's statements in this database, or says why not: the
 * extension missing, not in shared_preload_libraries, or the role unable to see other roles'
 * statements. Never throws.
 */
async function openStatements(
  statsUrl: string | null,
  appRole: string,
): Promise<StatementsReader | { reason: string }> {
  if (!statsUrl) return { reason: 'no stats connection (set PERF_STATS_URL).' };
  const client = new Client({ connectionString: statsUrl, application_name: 'nthstock-perf' });
  try {
    await client.connect();
  } catch (error) {
    return { reason: `cannot connect for pg_stat_statements: ${message(error)}` };
  }
  let createError = '';
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
  } catch (error) {
    createError = ` (CREATE EXTENSION failed: ${message(error)})`;
  }
  const snapshot = async (): Promise<StatementRow[]> => {
    const { rows } = await client.query<{
      queryid: string | null;
      query: string | null;
      calls: number;
      total: number;
      mean: number;
      stddev: number;
      max: number;
    }>(
      `SELECT s.queryid::text AS queryid, s.query, s.calls::float8 AS calls,
              s.total_exec_time AS total, s.mean_exec_time AS mean,
              s.stddev_exec_time AS stddev, s.max_exec_time AS max
         FROM pg_stat_statements s
        WHERE s.toplevel
          AND s.dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND s.userid = (SELECT oid FROM pg_roles WHERE rolname = $1)`,
      [appRole],
    );
    if (rows.length > 0 && rows.every((row) => row.queryid === null)) {
      throw new Error(
        "this role cannot see the app role's statements: use a superuser or a role with " +
          'pg_read_all_stats for PERF_STATS_URL',
      );
    }
    return rows.flatMap((row) =>
      row.queryid === null
        ? []
        : [
            {
              queryid: row.queryid,
              query: row.query ?? '',
              calls: row.calls,
              totalMs: row.total,
              meanMs: row.mean,
              stddevMs: row.stddev,
              maxMs: row.max,
            },
          ],
    );
  };
  try {
    await snapshot();
  } catch (error) {
    await client.end().catch(() => undefined);
    return { reason: `${message(error)}${createError}` };
  }
  return { snapshot, close: () => client.end() };
}

type SeededUser = { index: number; userId: string };

/**
 * Makes sure perf users 0 … count-1 exist with the PIN and a trusted device, through the app's
 * own Postgres repos (so PII is encrypted and every row is valid). Idempotent: a user that already
 * has its device is left alone. Throwaway device tokens; the measured users get fresh ones.
 */
async function seedUsers(
  app: App,
  count: number,
  log: (line: string) => void,
): Promise<{ users: SeededUser[]; created: number }> {
  const { users, auth } = app.deps.repos;
  const pinHash = await app.deps.pinHasher.hash(PERF_PIN);
  let created = 0;
  const seeded = await inPool(count, SEED_CONCURRENCY, async (index) => {
    const mobile = perfMobile(index);
    const deviceId = perfDeviceId(index);
    const existing = await users.findByMobile(mobile);
    if (existing && (await auth.getDevice(deviceId))?.userId === existing.id) {
      return { index, userId: existing.id };
    }
    const user =
      existing ??
      (await users.create(
        { mobile },
        { purpose: 'TERMS_AND_PRIVACY', policyVersion: CONSENT_POLICY_VERSION },
      ));
    if (!existing) created += 1;
    await auth.setPin(user.id, pinHash);
    await users.update(user.id, { pinSet: true });
    const now = app.deps.clock.now();
    await auth.createDevice({
      id: deviceId,
      userId: user.id,
      label: 'Perf smoke',
      trusted: true,
      createdAt: now,
      lastSeenAt: now,
    });
    await auth.putDeviceToken(hashToken(randomBytes(32).toString('base64url')), {
      deviceId,
      expiresAt: new Date(now.getTime() + TRUSTED_DEVICE_TTL_SEC * 1000),
    });
    if ((index + 1) % 1000 === 0) log(`  seeded ${String(index + 1)}/${String(count)} users`);
    return { index, userId: user.id };
  });
  return { users: seeded, created };
}

/** A fresh trusted-device token for a seeded user, and its PIN lock lifted. */
async function issueDeviceToken(app: App, user: SeededUser): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await app.deps.repos.auth.putDeviceToken(hashToken(token), {
    deviceId: perfDeviceId(user.index),
    expiresAt: new Date(app.deps.clock.now().getTime() + TRUSTED_DEVICE_TTL_SEC * 1000),
  });
  await app.deps.repos.auth.clearPinFailures(user.userId);
  return token;
}

/** The value of one Set-Cookie on a response. */
function cookieValue(response: LightMyRequestResponse, name: string): string | null {
  const header = response.headers['set-cookie'];
  const list = header === undefined ? [] : Array.isArray(header) ? header : [header];
  const line = list.find((cookie) => cookie.startsWith(`${name}=`));
  return line ? (line.split(';')[0] ?? '').slice(name.length + 1) : null;
}

/** "route status CODE" for the report; the error code only, never the body. */
function failureOf(route: string, response: LightMyRequestResponse): string {
  let code = '';
  try {
    const body: unknown = response.json();
    if (typeof body === 'object' && body !== null && 'code' in body) code = String(body.code);
  } catch {
    // Not JSON: the status says enough.
  }
  return `${route}: ${String(response.statusCode)} ${code}`.trim();
}

/** Seeds, measures and reads the statements; the caller renders and judges the result. */
export async function runPerfSmoke(options: PerfSmokeOptions): Promise<PerfSmokeResult> {
  const log = options.log ?? (() => undefined);
  const { users: userCount, samples, warmup, concurrency } = options;
  if (samples < 1 || warmup < 0 || samples + warmup > userCount) {
    throw new Error('need 1 ≤ samples and samples + warmup ≤ users');
  }
  const startedAt = new Date();
  const clock = tradingDayClock();
  const master = generateSymbolMaster();
  const market = new MockMarketDataAdapter({
    master,
    clock,
    // No ticks: orders fill on the opening quotes, and the timings measure the request alone.
    scheduler: { setInterval: () => 0, clearInterval: () => undefined },
  });
  const tokens = master.equities.slice(0, ORDER_TOKENS).map((equity) => equity.instrument.token);
  const app = buildApp({
    deps: {
      clock,
      market,
      dbDriver: 'postgres',
      databaseUrl: options.databaseUrl,
      ...(options.poolMax === undefined ? {} : { pgPoolMax: options.poolMax }),
    },
    orderSweepMs: null,
  });
  const appRole = decodeURIComponent(new URL(options.databaseUrl).username);
  let statements: StatementsReader | { reason: string } = { reason: 'not opened' };
  try {
    await app.ready();
    log(`Seeding ${String(userCount)} users…`);
    const seedStarted = performance.now();
    const seeded = await seedUsers(app, userCount, log);
    const seedMs = performance.now() - seedStarted;
    log(`Seeded in ${(seedMs / 1000).toFixed(1)} s (${String(seeded.created)} new).`);

    // Spread the measured users over the whole range rather than the first rows.
    const picked = Array.from({ length: warmup + samples }, (_, k) => {
      const user = seeded.users[Math.floor((k * userCount) / (warmup + samples))];
      if (!user) throw new Error('seeded user missing');
      return user;
    });
    const deviceTokens = await inPool(picked.length, SEED_CONCURRENCY, (k) =>
      issueDeviceToken(app, picked[k] as SeededUser),
    );

    const failures: string[] = [];
    const fail = (failure: string) => {
      if (failures.length < MAX_FAILURES_REPORTED) failures.push(failure);
    };
    const access = new Array<string | null>(picked.length).fill(null);
    const pinLogin = async (k: number) => {
      const started = performance.now();
      const response = await app.inject({
        method: 'POST',
        url: routes.pinVerify.path,
        remoteAddress: addressOf(k),
        headers: {
          cookie: `${AUTH_COOKIES.device}=${deviceTokens[k] ?? ''}`,
          [AUTH_CSRF_HEADER]: 'pre-session',
        },
        payload: { pin: PERF_PIN },
      });
      const elapsed = performance.now() - started;
      access[k] = response.statusCode === 200 ? cookieValue(response, AUTH_COOKIES.access) : null;
      if (access[k] === null) fail(failureOf('PIN login', response));
      return access[k] === null ? null : elapsed;
    };
    const placeOrder = async (k: number) => {
      const token = access[k];
      if (!token) return null;
      const started = performance.now();
      const response = await app.inject({
        method: 'POST',
        url: routes.orderPlace.path,
        remoteAddress: addressOf(k),
        headers: { authorization: `Bearer ${token}`, [AUTH_CSRF_HEADER]: 'bearer' },
        payload: {
          token: tokens[k % tokens.length],
          side: 'BUY',
          type: 'MARKET',
          product: 'DELIVERY',
          qty: 1,
        },
      });
      const elapsed = performance.now() - started;
      if (response.statusCode !== 200) {
        fail(failureOf('MARKET order', response));
        return null;
      }
      return elapsed;
    };

    log(`Warming up (${String(warmup)})…`);
    await inPool(warmup, concurrency, pinLogin);
    await inPool(warmup, concurrency, placeOrder);

    statements = await openStatements(options.statsUrl, appRole);
    const before = 'snapshot' in statements ? await statements.snapshot() : [];
    const recorder = recordClientQueries();
    let clientSamples = new Map<string, number[]>();
    let pinTimes: (number | null)[];
    let orderTimes: (number | null)[];
    try {
      log(`Measuring ${String(samples)} PIN logins and ${String(samples)} MARKET orders…`);
      pinTimes = await inPool(samples, concurrency, (k) => pinLogin(warmup + k));
      orderTimes = await inPool(samples, concurrency, (k) => placeOrder(warmup + k));
    } finally {
      // Audit entries queued by the orders are part of the work: write them before stopping.
      await app.deps.orders.flushAudit();
      clientSamples = recorder.stop();
    }
    const pgStatStatements: PgStatStatements =
      'snapshot' in statements
        ? {
            available: true,
            statements: statementDeltas(before, await statements.snapshot()),
          }
        : { available: false, reason: statements.reason };

    const ok = (times: (number | null)[]) => times.filter((t): t is number => t !== null);
    const pinOk = ok(pinTimes);
    const orderOk = ok(orderTimes);
    return {
      startedAt,
      seed: { users: userCount, created: seeded.created, ms: seedMs },
      pinLogin: summarize(pinOk, samples - pinOk.length),
      orderAck: summarize(orderOk, samples - orderOk.length),
      pgStatStatements,
      clientQueries: queryTimings(clientSamples),
      failures,
      config: {
        'Warm-up requests (not counted)': warmup,
        'Requests in flight': concurrency,
        'App pool (PG_POOL_MAX)': options.poolMax ?? 'default',
        'App role': appRole,
        Node: process.version,
        Market:
          'mock, no ticks; NSE hours on a fixed trading day (28 Sep 2026 10:00 IST); 20 large caps',
        Transport: 'in-process (`app.inject`), one loopback address per user; no Redis',
      },
    };
  } finally {
    if ('close' in statements) await statements.close().catch(() => undefined);
    await app.close();
    market.dispose();
  }
}
