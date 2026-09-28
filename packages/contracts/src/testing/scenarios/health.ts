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
  {
    name: 'reports ready when no backing service is configured',
    async run(client) {
      // MSW has no Postgres or Redis; the scenario backend runs apps/api on the memory driver
      // without Redis. A down dependency (503) is covered by apps/api's own tests.
      expect(await client.call('healthReady')).toEqual({ postgres: 'disabled', redis: 'disabled' });
    },
  },
]);
