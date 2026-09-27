import { defineConfig } from 'vitest/config';

/**
 * Wall-clock latency tests (T-171). They run alone and without coverage instrumentation, so the
 * numbers measure the pipeline, not a runner busy with other suites. CI runs them in the api-mode
 * job after apps/api is built, against that job's Redis service (REDIS_TEST_URL).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.latency.test.ts'],
  },
});
