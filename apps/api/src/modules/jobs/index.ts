// Public API of the jobs module (BullMQ jobs, spec backend-core §9). The worker entry and the app
// wiring import it only through this file; tests may import internals.
export {
  JOB_NAMES,
  type Job,
  type JobName,
  type JobResult,
  type JobSchedule,
} from './definitions.js';
export { createJobs, type JobsDeps } from './jobs.js';
export { safeErrorMessage, type JobLog, type JobOutcome } from './runner.js';
export {
  JOBS_QUEUE,
  startJobScheduler,
  type JobScheduler,
  type JobSchedulerOptions,
} from './scheduler.js';
