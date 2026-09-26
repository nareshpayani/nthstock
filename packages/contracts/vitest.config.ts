import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Scenario files are exercised by the backend runners (apps/api, apps/web), not here.
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/fixtures.ts',
        'src/testing/index.ts',
        'src/testing/scenarios/**',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
