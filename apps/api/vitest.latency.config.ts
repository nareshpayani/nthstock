import { defineConfig } from 'vitest/config';

/**
 * Wall-clock latency tests (NSTOCK-0370). They run alone and without coverage instrumentation, so
 * the numbers measure the fill path, not a runner busy with other suites. They need Postgres and
 * Redis, as the integration tests do (docs/runbooks/load-test.md "Matcher").
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.latency.test.ts'],
  },
});
