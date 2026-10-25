import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import {
  describeWithRedis,
  startTestRedis,
  uniqueChannel,
  type TestRedis,
} from '../../test/testRedis.js';
import { JOB_SCHEDULES, type Job, type JobName } from './definitions.js';
import { startJobScheduler, type JobScheduler } from './scheduler.js';

const EVERY_SECOND = () => '* * * * * *';

type Logged = {
  level: 'info' | 'warn' | 'error';
  message: string;
  fields: Record<string, unknown>;
};

function memoryLog() {
  const lines: Logged[] = [];
  return {
    lines,
    info: (message: string, fields: Record<string, unknown> = {}) =>
      lines.push({ level: 'info', message, fields }),
    warn: (message: string, fields: Record<string, unknown> = {}) =>
      lines.push({ level: 'warn', message, fields }),
    error: (message: string, fields: Record<string, unknown> = {}) =>
      lines.push({ level: 'error', message, fields }),
  };
}

const testJob = (name: JobName, run: Job['run']): Job => ({
  name,
  schedule: JOB_SCHEDULES[name],
  run,
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, timeoutMs = 10_000) {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out waiting');
    await sleep(50);
  }
}

describeWithRedis('BullMQ job scheduler (T-207, T-211)', () => {
  let redis: TestRedis;
  const started: JobScheduler[] = [];
  const clients: Redis[] = [];

  beforeAll(async () => {
    redis = await startTestRedis();
  }, 60_000);

  afterEach(async () => {
    for (const scheduler of started.splice(0)) await scheduler.close();
    for (const client of clients.splice(0)) await client.quit();
  });

  afterAll(async () => {
    await redis.stop();
  });

  const connection = () => {
    const client = new Redis(redis.url, { maxRetriesPerRequest: null });
    clients.push(client);
    return client;
  };

  async function start(options: Omit<Parameters<typeof startJobScheduler>[0], 'connection'>) {
    const scheduler = await startJobScheduler({ connection: connection(), ...options });
    started.push(scheduler);
    return scheduler;
  }

  it('runs a repeatable job once per scheduled time across two workers', async () => {
    const prefix = uniqueChannel('jobs-once');
    const runs: number[] = [];
    const job = testJob('db.orderPartitions', (at) => {
      runs.push(at.getTime());
      return Promise.resolve({ partitions: 0 });
    });
    await start({ jobs: [job], log: memoryLog(), prefix, cronOverride: EVERY_SECOND });
    await start({ jobs: [job], log: memoryLog(), prefix, cronOverride: EVERY_SECOND });
    await waitFor(() => runs.length >= 3);
    for (const scheduler of started.splice(0)) await scheduler.close();

    expect(new Set(runs).size).toBe(runs.length);
    // `run(at)` gets the time the job was due: a whole second, one second apart.
    for (const at of runs) expect(at % 1_000).toBe(0);
    const sorted = [...runs].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      expect((sorted[i] ?? 0) - (sorted[i - 1] ?? 0)).toBeGreaterThanOrEqual(1_000);
    }
  }, 20_000);

  it('skips a market-session job on a listed holiday, and still runs maintenance', async () => {
    const prefix = uniqueChannel('jobs-holiday');
    // Every date is a holiday, so the test does not depend on today (runner.test.ts covers the
    // calendar with fixed dates); this proves the scheduler applies it.
    const everyDay = new Proxy<Record<string, string>>({}, { get: () => 'Test holiday' });
    let sessionRuns = 0;
    let maintenanceRuns = 0;
    const log = memoryLog();
    await start({
      jobs: [
        testJob('session.amoRelease', () => {
          sessionRuns += 1;
          return Promise.resolve({ accounts: 0 });
        }),
        testJob('auth.tokenCleanup', () => {
          maintenanceRuns += 1;
          return Promise.resolve({ sessions: 0 });
        }),
      ],
      log,
      prefix,
      holidays: everyDay,
      cronOverride: EVERY_SECOND,
    });
    await waitFor(() => maintenanceRuns >= 2);
    await waitFor(() => log.lines.filter((line) => line.fields.skipped).length >= 2);
    expect(sessionRuns).toBe(0);
    expect(log.lines.find((line) => line.fields.skipped)?.fields).toMatchObject({
      job: 'session.amoRelease',
      skipped: 'notTradingDay',
    });
  }, 20_000);

  it('retries a failed run with backoff and logs the failure without PII', async () => {
    const prefix = uniqueChannel('jobs-retry');
    const attempts = new Map<number, number>();
    const log = memoryLog();
    let firstAt: number | null = null;
    await start({
      jobs: [
        // A maintenance job, so the run does not depend on today being a trading day.
        testJob('auth.tokenCleanup', (at) => {
          const key = at.getTime();
          firstAt ??= key;
          const attempt = (attempts.get(key) ?? 0) + 1;
          attempts.set(key, attempt);
          if (key === firstAt && attempt < 3) {
            // What a Postgres unique violation looks like: `detail` names the row's values.
            throw Object.assign(new Error('duplicate key value violates unique constraint'), {
              detail: 'Key (mobile)=(9876543210) already exists.',
            });
          }
          return Promise.resolve({ sessions: 1 });
        }),
      ],
      log,
      prefix,
      backoffMs: 100,
      cronOverride: EVERY_SECOND,
    });
    await waitFor(() => firstAt !== null && (attempts.get(firstAt) ?? 0) >= 3);
    await waitFor(() =>
      log.lines.some((line) => line.message === 'job finished' && line.fields.attempt === 3),
    );

    const failures = log.lines.filter((line) => line.message === 'job failed');
    expect(failures.slice(0, 2).map((line) => line.fields.attempt)).toEqual([1, 2]);
    expect(failures[0]?.fields).toMatchObject({ job: 'auth.tokenCleanup', attempts: 3 });
    expect(JSON.stringify(log.lines)).not.toContain('9876543210');
  }, 20_000);

  it('logs the last failed attempt as an error', async () => {
    const prefix = uniqueChannel('jobs-give-up');
    const log = memoryLog();
    await start({
      jobs: [testJob('auth.tokenCleanup', () => Promise.reject(new TypeError('always')))],
      log,
      prefix,
      backoffMs: 50,
      cronOverride: EVERY_SECOND,
    });
    await waitFor(() => log.lines.some((line) => line.level === 'error'));
    expect(log.lines.find((line) => line.level === 'error')).toMatchObject({
      message: 'job gave up',
      fields: { job: 'auth.tokenCleanup', attempt: 3, attempts: 3, error: 'TypeError' },
    });
  }, 20_000);

  it('stops cleanly: close waits for the running job to finish', async () => {
    const prefix = uniqueChannel('jobs-close');
    let running = false;
    let finished = 0;
    const scheduler = await start({
      jobs: [
        testJob('db.orderPartitions', async () => {
          running = true;
          await sleep(400);
          finished += 1;
          running = false;
          return { partitions: 0 };
        }),
      ],
      log: memoryLog(),
      prefix,
      cronOverride: EVERY_SECOND,
    });
    await waitFor(() => running);
    started.splice(started.indexOf(scheduler), 1);
    await scheduler.close();
    expect(running).toBe(false);
    expect(finished).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it('removes the scheduler of a job that is no longer registered', async () => {
    const prefix = uniqueChannel('jobs-stale');
    const job = testJob('auth.tokenCleanup', () => Promise.resolve({ sessions: 0 }));
    const old = testJob('account.purge', () => Promise.resolve({ accounts: 0 }));
    const first = await start({ jobs: [job, old], log: memoryLog(), prefix });
    expect((await first.queue.getJobSchedulers()).map((s) => s.key).sort()).toEqual([
      'account.purge',
      'auth.tokenCleanup',
    ]);
    const second = await start({ jobs: [job], log: memoryLog(), prefix });
    expect((await second.queue.getJobSchedulers()).map((s) => s.key)).toEqual([
      'auth.tokenCleanup',
    ]);
    expect((await second.queue.getJobSchedulers())[0]).toMatchObject({
      pattern: '0 3 * * *',
      tz: 'Asia/Kolkata',
    });
  });
});
