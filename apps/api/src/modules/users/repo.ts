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

/** A consent granted at sign-up (spec backend-core §10); stored with the user, in one write. */
export type ConsentGrant = { purpose: 'TERMS_AND_PRIVACY'; policyVersion: string };

export type ConsentRecord = ConsentGrant & { grantedAt: Date; withdrawnAt: Date | null };

/** A deleted account waiting for its purge (NSTOCK-0229). */
export type DeletedUser = { id: string; deletedAt: Date; purgeAfter: Date };
export type UserPatch = Partial<Omit<UserRecord, 'id' | 'mobile' | 'createdAt'>>;

/** Thrown by `create` when a live user already has the mobile. */
export class DuplicateMobileError extends Error {
  constructor() {
    super('A user with this mobile already exists');
    this.name = 'DuplicateMobileError';
  }
}

/**
 * Storage seam for the users module (ADR 0004 §3): in memory (unit tests, `DB_DRIVER=memory`) or
 * in Postgres (`pgRepo.ts`, T-190), both held to one conformance suite (`repo.test.ts`).
 */
export interface UsersRepo {
  /** The live user with this id; a deleted (or purged) one reads as null. */
  findById(id: string): Promise<UserRecord | null>;
  /** The live (not deleted) user with this mobile. */
  findByMobile(mobile: string): Promise<UserRecord | null>;
  /**
   * Throws `DuplicateMobileError` when a live user already has the mobile. `consent` is stored with
   * the user in the same write, so a user never exists without it.
   */
  create(user: NewUser, consent?: ConsentGrant): Promise<UserRecord>;
  listConsents(userId: string): Promise<ConsentRecord[]>;
  /** The deleted, not yet purged account of this mobile, or null. */
  findDeletedByMobile(mobile: string): Promise<DeletedUser | null>;
  /** Marks a live user deleted; resolves false when there is no such live user. */
  markDeleted(id: string, at: Date, purgeAfter: Date): Promise<boolean>;
  /** Applies `patch`; resolves to `null` when the user does not exist. */
  update(id: string, patch: UserPatch): Promise<UserRecord | null>;
  /**
   * Stores this exact user (id and timestamps included) unless a user with its id or its mobile
   * exists; resolves true when it did. For fixed seed users such as the demo user.
   */
  ensureSeeded(user: UserRecord): Promise<boolean>;
  /**
   * Tests only: drops every change and restores the seeded demo user. The Postgres repo refuses
   * (tests truncate its tables as the owner).
   */
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
  const consents = new Map<string, ConsentRecord[]>();
  const deleted = new Map<string, DeletedUser & { mobile: string }>();
  const seed = () => {
    byId.clear();
    consents.clear();
    deleted.clear();
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
    create: async (user, consent) => {
      if ([...byId.values()].some((u) => u.mobile === user.mobile)) {
        throw new DuplicateMobileError();
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
      if (consent) {
        consents.set(record.id, [{ ...consent, grantedAt: record.createdAt, withdrawnAt: null }]);
      }
      return Promise.resolve(copy(record));
    },
    listConsents: (userId) =>
      Promise.resolve(
        (consents.get(userId) ?? []).map((c) => ({ ...c, grantedAt: new Date(c.grantedAt) })),
      ),
    findDeletedByMobile: (mobile) => {
      const found = [...deleted.values()]
        .filter((d) => d.mobile === mobile)
        .sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime())[0];
      return Promise.resolve(
        found
          ? {
              id: found.id,
              deletedAt: new Date(found.deletedAt),
              purgeAfter: new Date(found.purgeAfter),
            }
          : null,
      );
    },
    markDeleted: (id, at, purgeAfter) => {
      const current = byId.get(id);
      if (!current) return Promise.resolve(false);
      byId.delete(id);
      deleted.set(id, { id, mobile: current.mobile, deletedAt: new Date(at), purgeAfter });
      return Promise.resolve(true);
    },
    update: (id, patch) => {
      const current = byId.get(id);
      if (!current) return Promise.resolve(null);
      const next = { ...current, ...patch };
      byId.set(id, next);
      return Promise.resolve(copy(next));
    },
    ensureSeeded: (user) => {
      if (byId.has(user.id) || [...byId.values()].some((u) => u.mobile === user.mobile)) {
        return Promise.resolve(false);
      }
      byId.set(user.id, copy(user));
      return Promise.resolve(true);
    },
    reset: () => {
      seed();
      return Promise.resolve();
    },
  };
}
