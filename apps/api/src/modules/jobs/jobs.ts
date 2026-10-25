import { JOB_SCHEDULES, type Job, type JobName, type JobResult } from './definitions.js';
import { runOrderPartitions, runTokenCleanup, type MaintenanceJobDeps } from './maintenanceJobs.js';
import { runAmoRelease, runDayClose, runSquareOff, type SessionJobDeps } from './sessionJobs.js';

/** Everything the jobs read and write, taken from the worker's `AppDeps`. */
export type JobsDeps = SessionJobDeps & MaintenanceJobDeps;

function job(name: JobName, run: (at: Date) => Promise<JobResult>): Job {
  return { name, schedule: JOB_SCHEDULES[name], run };
}

/** Every scheduled job with its dependencies bound (spec backend-core §9). */
export function createJobs(deps: JobsDeps): Job[] {
  return [
    job('session.amoRelease', (at) => runAmoRelease(at, deps)),
    job('session.squareOff', (at) => runSquareOff(at, deps)),
    job('session.dayClose', (at) => runDayClose(at, deps)),
    job('db.orderPartitions', (at) => runOrderPartitions(at, deps)),
    job('auth.tokenCleanup', (at) => runTokenCleanup(at, deps)),
  ];
}
