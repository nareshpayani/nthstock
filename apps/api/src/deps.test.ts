import { fixedClock, systemClock } from '@nthstock/utils';
import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from './db/client.js';
import { createDeps, resetRepos } from './deps.js';
import { DEMO_USER, createMemoryUsersRepo } from './modules/users/repo.js';

describe('createDeps', () => {
  it('defaults to the system clock and fresh in-memory repos', async () => {
    const a = createDeps();
    const b = createDeps();

    expect(a.clock).toBe(systemClock);
    await a.repos.users.create({ mobile: '9876543210' });
    expect(await b.repos.users.findByMobile('9876543210')).toBeNull();
    await a.dispose();
    await b.dispose();
  });

  it('takes an injected clock and repos', async () => {
    const clock = fixedClock('2026-09-25T04:00:00.000Z');
    const users = createMemoryUsersRepo({ clock });

    const deps = createDeps({ clock, repos: { users } });
    await deps.dispose();

    expect(deps.clock).toBe(clock);
    expect(deps.repos.users).toBe(users);
  });

  it('resets every repo to its seed', async () => {
    const { repos, dispose } = createDeps();
    await repos.users.create({ mobile: '9876543210' });
    await repos.users.update(DEMO_USER.id, { pinSet: true });

    await resetRepos(repos);

    expect(await repos.users.findByMobile('9876543210')).toBeNull();
    expect(await repos.users.findById(DEMO_USER.id)).toEqual(DEMO_USER);
    await dispose();
  });

  it('uses no database on the default memory driver (T-182)', async () => {
    const deps = createDeps();

    expect(deps.dbDriver).toBe('memory');
    expect(deps.database).toBeNull();
    await deps.dispose();
  });

  it('opens a Postgres pool for DB_DRIVER=postgres and closes it on dispose', async () => {
    const deps = createDeps({
      dbDriver: 'postgres',
      databaseUrl: 'postgres://nthstock_app:x@127.0.0.1:1/nthstock',
      pgPoolMax: 3,
    });
    const database = deps.database;

    expect(deps.dbDriver).toBe('postgres');
    expect(database).not.toBeNull();
    const close = vi.spyOn(database as NonNullable<typeof database>, 'close');
    await deps.dispose();
    expect(close).toHaveBeenCalledOnce();
  });

  it('leaves an injected database open', async () => {
    const database = createDatabase({ url: 'postgres://nthstock_app:x@127.0.0.1:1/nthstock' });
    const close = vi.spyOn(database, 'close');

    const deps = createDeps({ database });
    await deps.dispose();

    expect(deps.dbDriver).toBe('postgres');
    expect(deps.database).toBe(database);
    expect(close).not.toHaveBeenCalled();
    await database.close();
  });

  it('refuses DB_DRIVER=postgres without a URL', () => {
    expect(() => createDeps({ dbDriver: 'postgres' })).toThrow(/needs a DATABASE_URL/);
  });
});
