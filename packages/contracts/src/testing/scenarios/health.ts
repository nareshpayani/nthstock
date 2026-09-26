import { expect } from 'vitest';
import { defineScenarios } from '../harness.js';

export const healthScenarios = defineScenarios('health', [
  {
    name: 'reports ok with a version and the current UTC time',
    async run(client) {
      const health = await client.call('health');

      expect(health.status).toBe('ok');
      expect(health.version.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(health.time))).toBe(false);
    },
  },
]);
