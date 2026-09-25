import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

describe('GET /v1/health', () => {
  const app = buildApp();

  afterAll(async () => {
    await app.close();
  });

  it('returns ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });
});
