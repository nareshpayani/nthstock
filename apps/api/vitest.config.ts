import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // server.ts only reads the environment and listens; everything it calls is tested via buildApp.
      // The db:* CLIs only read the environment and call tested functions or drizzle-kit.
      exclude: ['src/**/*.test.ts', 'src/server.ts', 'src/db/*Cli.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
