import { createHash } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database, TransactionOptions } from '../../db/client.js';
import { createMemoryAuthRepo } from '../auth/repo.js';
import { JOB_SCHEDULES } from './definitions.js';
import { createJobs, type JobsDeps } from './jobs.js';
import {
  ORDER_PARTITION_DAYS,
  runOrderPartitions,
  runTokenCleanup,
  type MaintenanceJobDeps,
} from './maintenanceJobs.js';
import { runJob } from './runner.js';

// The maintenance jobs on the memory driver with a fixed clock (T-210); the Postgres side is in
// maintenanceJobs.integration.test.ts.

/** 00:30 IST on Monday 2026-10-26, given in UTC (still the 25th there). */
const AT = new Date('2026-10-25T19:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const days = (n: number) => new Date(AT.getTime() + n * DAY_MS);
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

/** A Database that records the one transaction the partition job runs, answering `created`. */
function recordingDatabase(rows: { created: number }[]) {
  const calls: { query: { sql: string; params: unknown[] }; options?: TransactionOptions }[] = [];
  const database = {
    transaction: (work: (handle: never) => Promise<unknown>, options?: TransactionOptions) => {
      const call = { query: { sql: '', params: [] as unknown[] }, ...(options ? { options } : {}) };
      calls.push(call);
      const tx = {
        execute: (query: SQL) => {
          call.query = new PgDialect().sqlToQuery(query);
          return Promise.resolve({ rows });
        },
      };
      return work(tx as never);
    },
  } as unknown as Database; // Only `transaction` is used by the job.
  return { database, calls };
}

describe('db.orderPartitions', () => {
  it('is a no-op on the memory driver', async () => {
    const deps: MaintenanceJobDeps = { database: null, auth: createMemoryAuthRepo() };
    expect(await runOrderPartitions(AT, deps)).toEqual({ partitions: 0 });
  });

  it('asks for 14 days from the IST date of the run, with a longer statement timeout', async () => {
    const { database, calls } = recordingDatabase([{ created: 3 }]);

    const result = await runOrderPartitions(AT, { database, auth: createMemoryAuthRepo() });

    expect(result).toEqual({ partitions: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query.sql).toMatch(/ensure_order_partitions\(\$1::date, \$2\)/);
    expect(calls[0]?.query.params).toEqual(['2026-10-26', ORDER_PARTITION_DAYS]);
    expect(ORDER_PARTITION_DAYS).toBe(14);
    expect(calls[0]?.options?.statementTimeoutMs).toBeGreaterThan(2_000);
  });

  it('counts 0 when no row comes back', async () => {
    const { database } = recordingDatabase([]);
    expect(await runOrderPartitions(AT, { database, auth: createMemoryAuthRepo() })).toEqual({
      partitions: 0,
    });
  });
});

describe('auth.tokenCleanup', () => {
  it('deletes expired rows, keeps live ones, and reports counts only', async () => {
    const auth = createMemoryAuthRepo();
    const device = (id: string) => ({
      id,
      userId: 'usr_a',
      label: 'Chrome on macOS',
      trusted: true,
      createdAt: days(-60),
      lastSeenAt: days(-60),
    });
    const session = (id: string, expiresAt: Date) => ({
      id,
      userId: 'usr_a',
      deviceId: 'dev_1',
      csrfToken: `csrf-${id}`,
      createdAt: days(-60),
      lastSeenAt: days(-60),
      expiresAt,
      steppedUpAt: null,
      revokedAt: null,
      revokedReason: null,
    });
    await auth.createDevice(device('dev_1'));
    await auth.createDevice(device('dev_2'));
    await auth.putDeviceToken(hashOf('t_old'), { deviceId: 'dev_1', expiresAt: days(-1) });
    await auth.putDeviceToken(hashOf('t_live'), { deviceId: 'dev_2', expiresAt: days(1) });
    await auth.createSession(session('ses_live', days(1)));
    await auth.createSession(session('ses_old', days(-31)));
    await auth.putRefreshToken(hashOf('r_live'), {
      sessionId: 'ses_live',
      expiresAt: days(1),
      usedAt: null,
    });
    await auth.putRefreshToken(hashOf('r_old'), {
      sessionId: 'ses_old',
      expiresAt: days(-31),
      usedAt: null,
    });

    const result = await runTokenCleanup(AT, { database: null, auth });

    expect(result).toEqual({ refreshTokens: 1, deviceTokens: 1, sessions: 1 });
    expect(await auth.getDeviceToken(hashOf('t_old'))).toBeNull();
    expect(await auth.getDeviceToken(hashOf('t_live'))).not.toBeNull();
    expect(await auth.getSession('ses_old')).toBeNull();
    expect(await auth.getSession('ses_live')).not.toBeNull();
    expect(await auth.useRefreshToken(hashOf('r_live'), AT)).not.toBeNull();
    expect(await runTokenCleanup(AT, { database: null, auth })).toEqual({
      refreshTokens: 0,
      deviceTokens: 0,
      sessions: 0,
    });
  });
});

describe('createJobs (maintenance)', () => {
  const deps = {
    database: null,
    auth: createMemoryAuthRepo(),
  } as unknown as JobsDeps; // The session-job deps are never called here.

  it('schedules both jobs daily at their IST times', () => {
    const jobs = createJobs(deps);
    for (const name of ['db.orderPartitions', 'auth.tokenCleanup'] as const) {
      expect(jobs.find((job) => job.name === name)?.schedule).toEqual(JOB_SCHEDULES[name]);
    }
    expect(JOB_SCHEDULES['db.orderPartitions']).toEqual({
      cron: '30 0 * * *',
      tradingDaysOnly: false,
    });
    expect(JOB_SCHEDULES['auth.tokenCleanup']).toEqual({
      cron: '0 3 * * *',
      tradingDaysOnly: false,
    });
  });

  it('runs them on a weekend too', async () => {
    const sunday = new Date('2026-10-24T21:30:00.000Z'); // 03:00 IST Sunday 2026-10-25
    const jobs = createJobs(deps);
    const run = (name: string) => {
      const job = jobs.find((candidate) => candidate.name === name);
      if (!job) throw new Error(`no job ${name}`);
      return runJob(job, sunday);
    };

    expect(await run('db.orderPartitions')).toEqual({
      status: 'done',
      result: { partitions: 0 },
    });
    expect(await run('auth.tokenCleanup')).toEqual({
      status: 'done',
      result: { refreshTokens: 0, deviceTokens: 0, sessions: 0 },
    });
  });
});
