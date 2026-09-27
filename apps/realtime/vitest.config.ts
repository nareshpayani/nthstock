import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Latency tests (*.latency.test.ts) measure wall-clock time, so they run on their own via
    // `npm run test:latency` (vitest.latency.config.ts), not beside every other suite under coverage.
    exclude: [...configDefaults.exclude, 'src/**/*.latency.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // server.ts only reads the environment and listens; everything it calls is tested directly.
      exclude: ['src/**/*.test.ts', 'src/test/**', 'src/server.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
