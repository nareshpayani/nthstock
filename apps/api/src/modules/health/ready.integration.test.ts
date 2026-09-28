import { beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import {
  describeWithPostgres,
  useTestPostgres,
  type TestPostgres,
} from '../../test/testPostgres.js';

describeWithPostgres('GET /v1/health/ready on real Postgres (integration, T-182)', () => {
  let pg: TestPostgres;

  beforeAll(async () => {
    pg = await useTestPostgres();
  }, 180_000);

  it('answers 200 with Postgres up, as the app role', async () => {
    const app = buildApp({ deps: { dbDriver: 'postgres', databaseUrl: pg.appUrl } });

    const response = await app.inject({ method: 'GET', url: '/v1/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ postgres: 'up', redis: 'disabled' });
    expect(app.deps.database).not.toBeNull();
    await app.close();
  });
});
