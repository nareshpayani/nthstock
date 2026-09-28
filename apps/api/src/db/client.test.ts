import { describe, expect, it } from 'vitest';
import { createDatabase } from './client.js';

/** Nothing listens on port 1, so a connection is refused at once. */
const UNREACHABLE = 'postgres://nthstock_app:x@127.0.0.1:1/nthstock';

describe('createDatabase', () => {
  it('connects lazily: creating and closing a pool opens nothing', async () => {
    const database = createDatabase({ url: UNREACHABLE });

    await database.close();
    await database.close();
  });

  it('fails ping when Postgres cannot be reached', async () => {
    const database = createDatabase({ url: UNREACHABLE, connectionTimeoutMillis: 1_000 });

    await expect(database.ping()).rejects.toThrow();
    await database.close();
  });

  it('refuses a statement timeout that is not a positive integer', async () => {
    const database = createDatabase({ url: UNREACHABLE });

    await expect(
      database.transaction(() => Promise.resolve(1), { statementTimeoutMs: 0 }),
    ).rejects.toThrow(/positive integer/);
    await expect(
      database.transaction(() => Promise.resolve(1), { statementTimeoutMs: 1.5 }),
    ).rejects.toThrow(/positive integer/);
    await database.close();
  });
});
