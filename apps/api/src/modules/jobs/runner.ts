import { isTradingDay, nseHolidays2026, type HolidayTable } from '@nthstock/utils';
import type { Job, JobResult } from './definitions.js';

export type JobLog = {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
};

export type JobOutcome =
  { status: 'done'; result: JobResult } | { status: 'skipped'; reason: 'notTradingDay' };

/**
 * Runs one job for its scheduled time `at`, skipping a market-session job on a weekend or NSE
 * holiday. Errors propagate so BullMQ retries; they are logged by the caller, never with PII.
 */
export async function runJob(
  job: Job,
  at: Date,
  { holidays = nseHolidays2026 }: { holidays?: HolidayTable } = {},
): Promise<JobOutcome> {
  if (job.schedule.tradingDaysOnly && !isTradingDay(at, holidays)) {
    return { status: 'skipped', reason: 'notTradingDay' };
  }
  return { status: 'done', result: await job.run(at) };
}

/**
 * A failure as it may be logged: the error classes down its `cause` chain and the first Postgres
 * SQLSTATE `code`, never a message. Drizzle's wrapper message holds the SQL and its bound values,
 * and a driver error's message and `detail` can name row values (a mobile number, an id).
 */
export function safeErrorMessage(error: unknown): string {
  const names: string[] = [];
  let code: string | null = null;
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
    if (!(current instanceof Error)) {
      names.push('non-error thrown');
      break;
    }
    names.push(current.name);
    const own = (current as { code?: unknown }).code;
    if (code === null && typeof own === 'string' && /^[0-9A-Z]{5}$/.test(own)) code = own;
    current = current.cause;
  }
  return code === null ? names.join(' < ') : `${names.join(' < ')} (SQLSTATE ${code})`;
}
