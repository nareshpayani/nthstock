import { describe, expect, it } from 'vitest';
import { JOB_NAMES, JOB_SCHEDULES, type Job } from './definitions.js';
import { runJob, safeErrorMessage } from './runner.js';
import { scheduledAt } from './scheduler.js';

/** Monday 28 Sep 2026 and Friday 2 Oct 2026 (Gandhi Jayanti, an NSE holiday), 09:15 IST. */
const MONDAY_OPEN = new Date('2026-09-28T03:45:00.000Z');
const HOLIDAY_OPEN = new Date('2026-10-02T03:45:00.000Z');
const SATURDAY = new Date('2026-09-26T03:45:00.000Z');

function counting(tradingDaysOnly: boolean): Job & { calls: Date[] } {
  const calls: Date[] = [];
  return {
    name: 'session.amoRelease',
    schedule: { cron: '15 9 * * 1-5', tradingDaysOnly },
    calls,
    run: (at) => {
      calls.push(at);
      return Promise.resolve({ accounts: 2 });
    },
  };
}

describe('runJob (T-207)', () => {
  it('runs on a trading day with the scheduled time', async () => {
    const job = counting(true);
    expect(await runJob(job, MONDAY_OPEN)).toEqual({ status: 'done', result: { accounts: 2 } });
    expect(job.calls).toEqual([MONDAY_OPEN]);
  });

  it('skips a market-session job on an NSE holiday and at the weekend', async () => {
    const job = counting(true);
    expect(await runJob(job, HOLIDAY_OPEN)).toEqual({ status: 'skipped', reason: 'notTradingDay' });
    expect(await runJob(job, SATURDAY)).toEqual({ status: 'skipped', reason: 'notTradingDay' });
    expect(await runJob(job, MONDAY_OPEN, { holidays: { '2026-09-28': 'Test' } })).toMatchObject({
      status: 'skipped',
    });
    expect(job.calls).toEqual([]);
  });

  it('runs maintenance every day', async () => {
    const job = counting(false);
    await runJob(job, HOLIDAY_OPEN);
    await runJob(job, SATURDAY);
    expect(job.calls).toHaveLength(2);
  });

  it('lets a failure through, for BullMQ to retry', async () => {
    const job = { ...counting(false), run: () => Promise.reject(new Error('down')) };
    await expect(runJob(job, MONDAY_OPEN)).rejects.toThrow('down');
  });
});

describe('job schedules (spec backend-core §9)', () => {
  it('has a schedule for every job, session jobs on trading days only', () => {
    expect(Object.keys(JOB_SCHEDULES).sort()).toEqual([...JOB_NAMES].sort());
    for (const name of JOB_NAMES) {
      expect(JOB_SCHEDULES[name].cron.split(' ')).toHaveLength(5);
      expect(JOB_SCHEDULES[name].tradingDaysOnly).toBe(
        name.startsWith('session.') || name === 'pnl.snapshot',
      );
    }
    expect(JOB_SCHEDULES['session.squareOff'].cron).toBe('20 15 * * 1-5');
  });
});

describe('safeErrorMessage', () => {
  it('keeps our own messages and drops a database error’s row values', () => {
    expect(safeErrorMessage(new RangeError('bad date'))).toBe('RangeError: bad date');
    const pg = Object.assign(new Error('duplicate key'), { detail: 'Key (mobile)=(9876543210)' });
    expect(safeErrorMessage(pg)).toBe('Error (database)');
    expect(safeErrorMessage('a string')).toBe('non-error thrown');
  });
});

describe('scheduledAt', () => {
  it('is the due time of a scheduled run, or when a one-off job was due', () => {
    expect(scheduledAt({ opts: { prevMillis: 1_000 }, timestamp: 5, delay: 0 })).toEqual(
      new Date(1_000),
    );
    expect(scheduledAt({ opts: {}, timestamp: 2_000, delay: 500 })).toEqual(new Date(2_500));
  });
});
