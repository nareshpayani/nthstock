import { isTradingDay, nseHolidays2026, type HolidayTable } from '@nthstock/utils';
import type { Job, JobResult } from './definitions.js';

export type JobLog = {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
};

export type JobOutcome =
  | { status: 'done'; result: JobResult }
  | { status: 'skipped'; reason: 'notTradingDay' };

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
 * The message of a failure without anything that might carry user data: only the error's class
 * name and, for our own errors, the message (a Postgres error's `detail` names row values).
 */
export function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'non-error thrown';
  const detail = (error as { detail?: unknown }).detail;
  return detail === undefined ? `${error.name}: ${error.message}` : `${error.name} (database)`;
}
