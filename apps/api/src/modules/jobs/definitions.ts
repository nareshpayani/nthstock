import { IST_TIME_ZONE } from '@nthstock/utils';

/**
 * The scheduled jobs (spec backend-core §9). Every time is IST: BullMQ evaluates `cron` in
 * `Asia/Kolkata`, so 09:15 means the NSE open whatever the server's time zone.
 */
export const JOB_NAMES = [
  'session.amoRelease',
  'session.squareOff',
  'session.dayClose',
  'pnl.snapshot',
  'db.orderPartitions',
  'auth.tokenCleanup',
  'account.purge',
] as const;

export type JobName = (typeof JOB_NAMES)[number];

export type JobSchedule = {
  /** Five-field cron (minute hour day month weekday), in `JOB_TIME_ZONE`. */
  cron: string;
  /** Market-session jobs skip weekends and NSE holidays; maintenance runs every day. */
  tradingDaysOnly: boolean;
};

export const JOB_TIME_ZONE = IST_TIME_ZONE;

export const JOB_SCHEDULES: Readonly<Record<JobName, JobSchedule>> = {
  'session.amoRelease': { cron: '15 9 * * 1-5', tradingDaysOnly: true },
  'session.squareOff': { cron: '20 15 * * 1-5', tradingDaysOnly: true },
  'session.dayClose': { cron: '30 15 * * 1-5', tradingDaysOnly: true },
  'pnl.snapshot': { cron: '45 15 * * 1-5', tradingDaysOnly: true },
  'db.orderPartitions': { cron: '30 0 * * *', tradingDaysOnly: false },
  'auth.tokenCleanup': { cron: '0 3 * * *', tradingDaysOnly: false },
  'account.purge': { cron: '0 2 * * *', tradingDaysOnly: false },
};

/**
 * What a run did, as counts only (accounts synced, rows deleted, …): it is logged and kept on the
 * BullMQ job, so it must never hold a user id, a mobile number or any other PII.
 */
export type JobResult = Readonly<Record<string, number>>;

/**
 * One job with its dependencies bound: a plain function of the scheduled time, so it is unit
 * tested with a fixed clock and BullMQ only schedules and retries it.
 */
export type Job = {
  name: JobName;
  schedule: JobSchedule;
  run(at: Date): Promise<JobResult>;
};
