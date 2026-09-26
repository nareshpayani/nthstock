import { fixedClock, systemClock } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import { createDeps, resetRepos } from './deps.js';
import { DEMO_USER, createMemoryUsersRepo } from './modules/users/repo.js';

describe('createDeps', () => {
  it('defaults to the system clock and fresh in-memory repos', async () => {
    const a = createDeps();
    const b = createDeps();

    expect(a.clock).toBe(systemClock);
    await a.repos.users.create({ mobile: '9876543210' });
    expect(await b.repos.users.findByMobile('9876543210')).toBeNull();
    a.dispose();
    b.dispose();
  });

  it('takes an injected clock and repos', () => {
    const clock = fixedClock('2026-09-25T04:00:00.000Z');
    const users = createMemoryUsersRepo({ clock });

    const deps = createDeps({ clock, repos: { users } });
    deps.dispose();

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
    dispose();
  });
});
