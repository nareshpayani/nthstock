import { systemClock, type Clock } from '@nthstock/utils';
import { createMemoryUsersRepo, type UsersRepo } from './modules/users/repo.js';

/** Every module's storage seam. In-memory in the mock phase (ADR 0004 §3). */
export type Repos = {
  users: UsersRepo;
};

/** What modules get injected instead of reaching for globals: time and storage. */
export type AppDeps = {
  clock: Clock;
  repos: Repos;
};

export type DepsOverrides = {
  clock?: Clock;
  repos?: Partial<Repos>;
};

/** Builds a fresh set of dependencies; each app (and each test app) gets its own in-memory state. */
export function createDeps(overrides: DepsOverrides = {}): AppDeps {
  const clock = overrides.clock ?? systemClock;
  return {
    clock,
    repos: {
      users: overrides.repos?.users ?? createMemoryUsersRepo({ clock }),
    },
  };
}

/** Restores every repo to its seeded state. */
export async function resetRepos(repos: Repos): Promise<void> {
  await Promise.all(Object.values(repos).map((repo) => repo.reset()));
}
