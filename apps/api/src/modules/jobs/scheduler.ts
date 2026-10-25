import {
  Queue,
  UnrecoverableError,
  Worker,
  type ConnectionOptions,
  type Job as BullJob,
} from 'bullmq';
import type { HolidayTable } from '@nthstock/utils';
import { JOB_TIME_ZONE, type Job } from './definitions.js';
import { runJob, safeErrorMessage, type JobLog, type JobOutcome } from './runner.js';

/** The one queue every scheduled job runs on (spec backend-core §9). */
export const JOBS_QUEUE = 'jobs';

/** Three attempts in all, 30 s then 60 s apart (`exponential`: delay × 2^(attempt − 1)). */
export const JOB_ATTEMPTS = 3;
export const JOB_BACKOFF_MS = 30_000;

export type JobSchedulerOptions = {
  /** Redis for BullMQ; the worker blocks on it, so give it a connection of its own. */
  connection: ConnectionOptions;
  jobs: readonly Job[];
  log: JobLog;
  /** BullMQ key prefix (default `nthstock:bull`); tests use their own. */
  prefix?: string;
  /** Tests: a shorter backoff and their own holiday table. */
  backoffMs?: number;
  holidays?: HolidayTable;
  /** Tests schedule faster patterns than the real crons (six fields, with seconds). */
  cronOverride?: (job: Job) => string;
};

export type JobScheduler = {
  queue: Queue<null, JobOutcome>;
  worker: Worker<null, JobOutcome>;
  /** Stops taking jobs, waits for the one running to finish, and closes both connections. */
  close(): Promise<void>;
};

/** The time a scheduled job was due, which is what its `run(at)` is for (not when it ran). */
export function scheduledAt(job: Pick<BullJob, 'opts' | 'timestamp' | 'delay'>): Date {
  return new Date(job.opts.prevMillis ?? job.timestamp + job.delay);
}

/**
 * Registers every job as a BullMQ job scheduler (cron in `Asia/Kolkata`) and starts a worker
 * that runs them. Schedulers for jobs no longer in `jobs` are removed, so a rename does not leave
 * an old one firing. Several workers may run: BullMQ hands each scheduled job to exactly one, and
 * the job id (scheduler id plus due time) keeps one run per scheduled time.
 */
export async function startJobScheduler(options: JobSchedulerOptions): Promise<JobScheduler> {
  const { connection, jobs, log } = options;
  const prefix = options.prefix ?? 'nthstock:bull';
  const byName = new Map<string, Job>(jobs.map((job) => [job.name, job]));
  const queue = new Queue<null, JobOutcome>(JOBS_QUEUE, { connection, prefix });

  for (const scheduler of await queue.getJobSchedulers()) {
    if (!byName.has(scheduler.key)) await queue.removeJobScheduler(scheduler.key);
  }
  for (const job of jobs) {
    await queue.upsertJobScheduler(
      job.name,
      { pattern: options.cronOverride?.(job) ?? job.schedule.cron, tz: JOB_TIME_ZONE },
      {
        name: job.name,
        data: null,
        opts: {
          attempts: JOB_ATTEMPTS,
          backoff: { type: 'exponential', delay: options.backoffMs ?? JOB_BACKOFF_MS },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      },
    );
  }

  const worker = new Worker<null, JobOutcome>(
    JOBS_QUEUE,
    async (bullJob) => {
      const job = byName.get(bullJob.name);
      // A job this worker does not know (an older or newer deployment's) is not retried.
      if (!job) throw new UnrecoverableError(`Unknown job ${bullJob.name}`);
      const at = scheduledAt(bullJob);
      const outcome = await runJob(job, at, options.holidays ? { holidays: options.holidays } : {});
      log.info('job finished', {
        job: job.name,
        scheduledAt: at.toISOString(),
        attempt: bullJob.attemptsMade + 1,
        ...(outcome.status === 'done' ? { result: outcome.result } : { skipped: outcome.reason }),
      });
      return outcome;
    },
    { connection, prefix, concurrency: 1 },
  );
  worker.on('failed', (bullJob, error) => {
    const attempt = bullJob?.attemptsMade ?? 0;
    const fields = {
      job: bullJob?.name,
      attempt,
      attempts: JOB_ATTEMPTS,
      error: safeErrorMessage(error),
    };
    // The last attempt is an error: with JOBS_MODE=bullmq nothing else runs that event.
    if (attempt >= JOB_ATTEMPTS) log.error('job gave up', fields);
    else log.warn('job failed', fields);
  });
  // A worker that died mid-run leaves its job stalled; BullMQ hands it to a live worker.
  worker.on('stalled', (jobId) => log.warn('job stalled', { jobId }));
  worker.on('error', (error) => log.warn('job worker error', { error: safeErrorMessage(error) }));
  await worker.waitUntilReady();

  return {
    queue,
    worker,
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
