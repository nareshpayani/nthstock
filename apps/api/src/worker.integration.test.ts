import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { JOB_NAMES, JOBS_QUEUE } from './modules/jobs/index.js';
import { describeWithPostgres, useTestPostgres, type TestPostgres } from './test/testPostgres.js';
import { startTestRedis, uniqueChannel, type TestRedis } from './test/testRedis.js';

const WORKER = fileURLToPath(new URL('./worker.ts', import.meta.url));
const API_DIR = fileURLToPath(new URL('..', import.meta.url));

describeWithPostgres('job worker process (T-207)', () => {
  let postgres: TestPostgres;
  let redis: TestRedis;

  beforeAll(async () => {
    [postgres, redis] = await Promise.all([useTestPostgres(), startTestRedis()]);
  }, 120_000);

  afterAll(async () => {
    await redis?.stop();
  });

  it('registers the jobs, then stops cleanly on SIGTERM', async () => {
    const prefix = uniqueChannel('nthstock:bull-worker');
    const child = spawn(process.execPath, ['--import', 'tsx', WORKER], {
      cwd: API_DIR,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        JOBS_MODE: 'bullmq',
        DB_DRIVER: 'postgres',
        DATABASE_URL: postgres.appUrl,
        PURGE_DATABASE_URL: postgres.purgeUrl,
        REDIS_URL: redis.url,
        JOBS_PREFIX: prefix,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));

    const until = Date.now() + 30_000;
    while (!output.includes('job worker started')) {
      if (Date.now() > until || child.exitCode !== null) throw new Error(`no start:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const connection = new Redis(redis.url, { maxRetriesPerRequest: null });
    const queue = new Queue(JOBS_QUEUE, { connection, prefix });
    const keys = (await queue.getJobSchedulers()).map((scheduler) => scheduler.key);
    await queue.close();
    await connection.quit();
    for (const key of keys) expect(JOB_NAMES).toContain(key);
    expect(keys).toContain('session.amoRelease');
    expect(keys).toContain('account.purge');

    child.kill('SIGTERM');
    expect(await exited).toBe(0);
    expect(output).toContain('job worker stopping');
  }, 60_000);
});
