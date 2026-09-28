import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createPiiCrypto, devPiiKeys } from '../../db/crypto.js';
import { describeRepoConformance } from '../../test/conformance.js';
import { manualClock } from '../../test/manualClock.js';
import { createPgUsersRepo } from '../users/pgRepo.js';
import { DEMO_USER } from '../users/repo.js';
import { createPgAuthRepo } from './pgRepo.js';
import { createMemoryAuthRepo, createMemoryOtpStore, type DeviceRecord } from './repo.js';

// The auth repo conformance suite: memory and Postgres behave the same. Devices, device tokens
// and PINs (T-191).

const clock = manualClock('2026-09-28T04:30:00.000Z');
const at = (iso: string) => new Date(iso);
/** A token hash as the services make them: SHA-256 in hex. */
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

const USERS = ['usr_a', 'usr_b'] as const;

const device = (id: string, userId: string = 'usr_a'): DeviceRecord => ({
  id,
  userId,
  label: 'Chrome on macOS',
  trusted: false,
  createdAt: at('2026-09-28T04:30:00.000Z'),
  lastSeenAt: at('2026-09-28T04:30:00.000Z'),
});

describeRepoConformance(
  'auth repo',
  {
    memory: () => createMemoryAuthRepo(),
    postgres: async (database) => {
      // Rows in these tables belong to users (foreign keys).
      const users = createPgUsersRepo({ database, clock, pii: createPiiCrypto(devPiiKeys()) });
      for (const [index, id] of USERS.entries()) {
        await users.ensureSeeded({ ...DEMO_USER, id, mobile: `900000010${String(index)}` });
      }
      return createPgAuthRepo({ database, clock, otp: createMemoryOtpStore() });
    },
  },
  ({ driver, repo }) => {
    // ---- Devices ---------------------------------------------------------------------------
    it('creates and reads a device; an unknown one is null', async () => {
      await repo().createDevice(device('dev_1'));

      expect(await repo().getDevice('dev_1')).toEqual(device('dev_1'));
      expect(await repo().getDevice('dev_missing')).toBeNull();
    });

    it('updates trust and last seen, and answers null for an unknown device', async () => {
      await repo().createDevice(device('dev_1'));

      const trusted = await repo().updateDevice('dev_1', { trusted: true });
      expect(trusted).toEqual({ ...device('dev_1'), trusted: true });
      const seen = await repo().updateDevice('dev_1', {
        lastSeenAt: at('2026-09-28T05:00:00.000Z'),
      });
      expect(seen).toEqual({
        ...device('dev_1'),
        trusted: true,
        lastSeenAt: at('2026-09-28T05:00:00.000Z'),
      });
      expect(await repo().getDevice('dev_1')).toEqual(seen);
      expect(await repo().updateDevice('dev_1', {})).toEqual(seen);
      expect(await repo().updateDevice('dev_missing', { trusted: true })).toBeNull();
    });

    it('hands out copies of devices', async () => {
      await repo().createDevice(device('dev_1'));
      const read = await repo().getDevice('dev_1');
      read?.lastSeenAt.setUTCFullYear(1999);

      expect(await repo().getDevice('dev_1')).toEqual(device('dev_1'));
    });

    // ---- Trusted-device tokens -------------------------------------------------------------
    it('stores a device token by its hash; a new token replaces the device’s old one', async () => {
      await repo().createDevice(device('dev_1'));
      await repo().createDevice(device('dev_2', 'usr_b'));
      const expiresAt = at('2027-03-27T04:30:00.000Z');

      await repo().putDeviceToken(hashOf('t1'), { deviceId: 'dev_1', expiresAt });
      await repo().putDeviceToken(hashOf('t2'), { deviceId: 'dev_2', expiresAt });
      expect(await repo().getDeviceToken(hashOf('t1'))).toEqual({ deviceId: 'dev_1', expiresAt });

      const later = at('2027-04-01T00:00:00.000Z');
      await repo().putDeviceToken(hashOf('t3'), { deviceId: 'dev_1', expiresAt: later });

      expect(await repo().getDeviceToken(hashOf('t1'))).toBeNull();
      expect(await repo().getDeviceToken(hashOf('t3'))).toEqual({
        deviceId: 'dev_1',
        expiresAt: later,
      });
      expect(await repo().getDeviceToken(hashOf('t2'))).toEqual({ deviceId: 'dev_2', expiresAt });
      expect(await repo().getDeviceToken(hashOf('unknown'))).toBeNull();
    });

    // ---- PINs ------------------------------------------------------------------------------
    it('stores a PIN hash with no failures; a user without one has none', async () => {
      expect(await repo().getPin('usr_a')).toBeNull();

      await repo().setPin('usr_a', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA');

      expect(await repo().getPin('usr_a')).toEqual({
        hash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
        failures: 0,
      });
      expect(await repo().getPin('usr_b')).toBeNull();
    });

    it('counts wrong PINs, clears them, and a new PIN starts from zero', async () => {
      await repo().setPin('usr_a', 'hash-1');

      expect(await repo().recordPinFailure('usr_a')).toBe(1);
      expect(await repo().recordPinFailure('usr_a')).toBe(2);
      expect(await repo().getPin('usr_a')).toEqual({ hash: 'hash-1', failures: 2 });

      await repo().clearPinFailures('usr_a');
      expect(await repo().getPin('usr_a')).toEqual({ hash: 'hash-1', failures: 0 });

      await repo().recordPinFailure('usr_a');
      await repo().setPin('usr_a', 'hash-2');
      expect(await repo().getPin('usr_a')).toEqual({ hash: 'hash-2', failures: 0 });
    });

    it('counts nothing for a user without a PIN', async () => {
      expect(await repo().recordPinFailure('usr_b')).toBe(0);
      await repo().clearPinFailures('usr_b');

      expect(await repo().getPin('usr_b')).toBeNull();
    });

    it('counts 5 concurrent wrong PINs to exactly 5, each with its own count', async () => {
      await repo().setPin('usr_a', 'hash-1');

      const counts = await Promise.all(
        Array.from({ length: 5 }, () => repo().recordPinFailure('usr_a')),
      );

      expect(counts.toSorted((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
      expect((await repo().getPin('usr_a'))?.failures).toBe(5);
    });

    if (driver === 'postgres') {
      it('refuses reset: tests truncate the tables as the owner', async () => {
        await expect(repo().reset()).rejects.toThrow(/does not reset/);
      });
    }
  },
);
