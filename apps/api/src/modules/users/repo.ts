import { randomUUID } from 'node:crypto';
import type { KycStatus } from '@nthstock/contracts';
import type { Clock } from '@nthstock/utils';

/** A stored user. `mobile` is the full number and never leaves the API (see `toUser`). */
export type UserRecord = {
  id: string;
  mobile: string;
  name: string | null;
  email: string | null;
  kycStatus: KycStatus;
  pinSet: boolean;
  totpEnabled: boolean;
  createdAt: Date;
};

export type NewUser = Pick<UserRecord, 'mobile'> & Partial<Pick<UserRecord, 'name' | 'email'>>;
export type UserPatch = Partial<Omit<UserRecord, 'id' | 'mobile' | 'createdAt'>>;

/**
 * Storage seam for the users module (ADR 0004 §3). In-memory now; a Drizzle/Postgres
 * implementation replaces it in Phase 3 without changes to callers.
 */
export interface UsersRepo {
  findById(id: string): Promise<UserRecord | null>;
  findByMobile(mobile: string): Promise<UserRecord | null>;
  create(user: NewUser): Promise<UserRecord>;
  /** Applies `patch`; resolves to `null` when the user does not exist. */
  update(id: string, patch: UserPatch): Promise<UserRecord | null>;
  /** Drops every change and restores the seeded demo user. Tests call it between cases. */
  reset(): Promise<void>;
}

/** The seeded demo user. The mobile is a made-up number (not a real subscriber). */
export const DEMO_USER = {
  id: 'usr_demo',
  mobile: '9000000001',
  name: 'Demo Investor',
  email: null,
  kycStatus: 'VERIFIED',
  pinSet: false,
  totpEnabled: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
} as const satisfies UserRecord;

export type MemoryUsersRepoOptions = {
  clock: Clock;
  /** Id generator for new users; default `usr_<uuid>`. */
  newId?: () => string;
};

const copy = (record: UserRecord): UserRecord => ({
  ...record,
  createdAt: new Date(record.createdAt),
});

export function createMemoryUsersRepo({
  clock,
  newId = () => `usr_${randomUUID()}`,
}: MemoryUsersRepoOptions): UsersRepo {
  const byId = new Map<string, UserRecord>();
  const seed = () => {
    byId.clear();
    byId.set(DEMO_USER.id, copy(DEMO_USER));
  };
  seed();

  // Records are copied in and out so callers can never mutate stored state by accident.
  return {
    findById: (id) => {
      const found = byId.get(id);
      return Promise.resolve(found ? copy(found) : null);
    },
    findByMobile: (mobile) => {
      const found = [...byId.values()].find((u) => u.mobile === mobile);
      return Promise.resolve(found ? copy(found) : null);
    },
    create: async (user) => {
      if ([...byId.values()].some((u) => u.mobile === user.mobile)) {
        throw new Error('A user with this mobile already exists');
      }
      const record: UserRecord = {
        id: newId(),
        mobile: user.mobile,
        name: user.name ?? null,
        email: user.email ?? null,
        kycStatus: 'NOT_STARTED',
        pinSet: false,
        totpEnabled: false,
        createdAt: clock.now(),
      };
      byId.set(record.id, record);
      return Promise.resolve(copy(record));
    },
    update: (id, patch) => {
      const current = byId.get(id);
      if (!current) return Promise.resolve(null);
      const next = { ...current, ...patch };
      byId.set(id, next);
      return Promise.resolve(copy(next));
    },
    reset: () => {
      seed();
      return Promise.resolve();
    },
  };
}
