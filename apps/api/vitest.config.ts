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
      // server.ts only reads the environment and listens; everything it calls is tested via buildApp.
      // worker.ts only reads the environment and starts the tested modules/jobs scheduler; its
      // start and SIGTERM stop are covered by worker.integration.test.ts in a child process.
      // candleWriter.ts only reads the environment and starts the tested modules/candles writer.
      // The db:* CLIs only read the environment and call tested functions or drizzle-kit.
      exclude: [
        'src/**/*.test.ts',
        'src/server.ts',
        'src/worker.ts',
        'src/candleWriter.ts',
        'src/**/*Cli.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
