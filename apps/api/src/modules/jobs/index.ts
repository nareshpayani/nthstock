// Public API of the jobs module (BullMQ jobs, spec backend-core §9). The worker entry and the app
// wiring import it only through this file; tests may import internals.
export {
  JOB_NAMES,
  JOB_SCHEDULES,
  JOB_TIME_ZONE,
  type Job,
  type JobName,
  type JobResult,
  type JobSchedule,
} from './definitions.js';
export { createJobs, type JobsDeps } from './jobs.js';
export { runJob, type JobLog, type JobOutcome } from './runner.js';
export {
  JOB_ATTEMPTS,
  JOB_BACKOFF_MS,
  JOBS_QUEUE,
  startJobScheduler,
  type JobScheduler,
  type JobSchedulerOptions,
} from './scheduler.js';
