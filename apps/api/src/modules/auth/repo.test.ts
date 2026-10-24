import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createPiiCrypto, devPiiKeys } from '../../db/crypto.js';
import { describeRepoConformance } from '../../test/conformance.js';
import { manualClock } from '../../test/manualClock.js';
import { createPgUsersRepo } from '../users/pgRepo.js';
import { DEMO_USER } from '../users/repo.js';
import { createPgAuthRepo } from './pgRepo.js';
import {
  createMemoryAuthRepo,
  createMemoryOtpStore,
  type DeviceRecord,
  type SessionRecord,
} from './repo.js';

// The auth repo conformance suite: memory and Postgres behave the same. Devices, device tokens
// and PINs (T-191); sessions and refresh tokens (T-192).

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

const session = (id: string, userId: string = 'usr_a', deviceId = 'dev_1'): SessionRecord => ({
  id,
  userId,
  deviceId,
  csrfToken: `csrf-${id}`,
  createdAt: at('2026-09-28T04:30:00.000Z'),
  lastSeenAt: at('2026-09-28T04:30:00.000Z'),
  expiresAt: at('2026-10-28T04:30:00.000Z'),
  steppedUpAt: null,
  revokedAt: null,
  revokedReason: null,
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
      return createPgAuthRepo({
        database,
        clock,
        pii: createPiiCrypto(devPiiKeys()),
        otp: createMemoryOtpStore(),
      });
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

    // ---- Sessions (T-192) --------------------------------------------------------------------
    it('creates and reads a session; an unknown one is null', async () => {
      await repo().createDevice(device('dev_1'));
      await repo().createSession(session('ses_1'));

      expect(await repo().getSession('ses_1')).toEqual(session('ses_1'));
      expect(await repo().getSession('ses_missing')).toBeNull();
    });

    it('revokes a session with its reason, keeping the first revocation', async () => {
      await repo().createDevice(device('dev_1'));
      await repo().createSession(session('ses_1'));
      await repo().createSession(session('ses_2'));

      await repo().revokeSession('ses_1', at('2026-09-28T05:00:00.000Z'), 'LOGOUT');
      await repo().revokeSession('ses_1', at('2026-09-28T06:00:00.000Z'), 'REUSE_DETECTED');
      await repo().revokeSession('ses_missing', at('2026-09-28T06:00:00.000Z'), 'LOGOUT');

      expect(await repo().getSession('ses_1')).toEqual({
        ...session('ses_1'),
        revokedAt: at('2026-09-28T05:00:00.000Z'),
        revokedReason: 'LOGOUT',
      });
      expect(await repo().getSession('ses_2')).toEqual(session('ses_2'));
    });

    it('touches last seen only when the stored time is stale (T-194)', async () => {
      await repo().createDevice(device('dev_1'));
      await repo().createSession(session('ses_1'));
      const created = session('ses_1').lastSeenAt;

      // Stored 04:30:00 is after staleBefore 04:29:59: no write.
      await repo().touchSession(
        'ses_1',
        at('2026-09-28T04:30:59.000Z'),
        at('2026-09-28T04:29:59.000Z'),
      );
      expect((await repo().getSession('ses_1'))?.lastSeenAt).toEqual(created);

      // At or before staleBefore: written.
      await repo().touchSession(
        'ses_1',
        at('2026-09-28T04:31:00.000Z'),
        at('2026-09-28T04:30:00.000Z'),
      );
      expect((await repo().getSession('ses_1'))?.lastSeenAt).toEqual(
        at('2026-09-28T04:31:00.000Z'),
      );
      await repo().touchSession('ses_missing', at('2026-09-28T05:00:00.000Z'), created);
    });

    it('writes last seen once when instances race on one session (T-194)', async () => {
      await repo().createDevice(device('dev_1'));
      await repo().createSession(session('ses_1'));
      const staleBefore = at('2026-09-28T04:31:00.000Z');

      await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          repo().touchSession('ses_1', at(`2026-09-28T04:32:0${String(i)}.000Z`), staleBefore),
        ),
      );

      // The first write makes the stored time fresh, so the others find nothing to update.
      const lastSeen = (await repo().getSession('ses_1'))?.lastSeenAt.toISOString() ?? '';
      expect(lastSeen).toMatch(/^2026-09-28T04:32:0[0-4]\.000Z$/);
    });

    it('hands out copies of sessions', async () => {
      await repo().createDevice(device('dev_1'));
      await repo().createSession(session('ses_1'));
      const read = await repo().getSession('ses_1');
      read?.expiresAt.setUTCFullYear(1999);

      expect(await repo().getSession('ses_1')).toEqual(session('ses_1'));
    });

    // ---- Refresh tokens (T-192) --------------------------------------------------------------
    it('uses a refresh token once: the first use sees it unused, later ones see when', async () => {
      await repo().createDevice(device('dev_1'));
      await repo().createSession(session('ses_1'));
      const expiresAt = at('2026-10-28T04:30:00.000Z');
      await repo().putRefreshToken(hashOf('r1'), { sessionId: 'ses_1', expiresAt, usedAt: null });

      expect(await repo().useRefreshToken(hashOf('r1'), at('2026-09-28T05:00:00.000Z'))).toEqual({
        sessionId: 'ses_1',
        expiresAt,
        usedAt: null,
        sessionRevokedAt: null,
      });
      expect(await repo().useRefreshToken(hashOf('r1'), at('2026-09-28T06:00:00.000Z'))).toEqual({
        sessionId: 'ses_1',
        expiresAt,
        usedAt: at('2026-09-28T05:00:00.000Z'),
        sessionRevokedAt: null,
      });
      // The first use's time stays.
      expect(await repo().useRefreshToken(hashOf('r1'), at('2026-09-28T07:00:00.000Z'))).toEqual({
        sessionId: 'ses_1',
        expiresAt,
        usedAt: at('2026-09-28T05:00:00.000Z'),
        sessionRevokedAt: null,
      });
      // A revoked session shows on the token's next use.
      await repo().revokeSession('ses_1', at('2026-09-28T08:00:00.000Z'), 'LOGOUT');
      expect(
        (await repo().useRefreshToken(hashOf('r1'), at('2026-09-28T09:00:00.000Z')))
          ?.sessionRevokedAt,
      ).toEqual(at('2026-09-28T08:00:00.000Z'));
      expect(await repo().useRefreshToken(hashOf('unknown'), at('2026-09-28T05:00:00.000Z'))).toBe(
        null,
      );
    });

    it('lets exactly one of 10 concurrent uses of one refresh token see it unused', async () => {
      await repo().createDevice(device('dev_1'));
      await repo().createSession(session('ses_1'));
      await repo().putRefreshToken(hashOf('r1'), {
        sessionId: 'ses_1',
        expiresAt: at('2026-10-28T04:30:00.000Z'),
        usedAt: null,
      });

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          repo().useRefreshToken(hashOf('r1'), at(`2026-09-28T05:00:0${String(i)}.000Z`)),
        ),
      );

      expect(results.filter((result) => result?.usedAt === null)).toHaveLength(1);
      const firstUse = results.find((result) => result?.usedAt)?.usedAt;
      for (const result of results) {
        if (result?.usedAt) expect(result.usedAt).toEqual(firstUse);
      }
    });

    // ---- Step-up and TOTP (NSTOCK-0214, NSTOCK-0215) -----------------------------------------
    it('records a step-up on the session', async () => {
      await repo().createDevice(device('dev_1'));
      await repo().createSession(session('ses_1'));
      await repo().stepUpSession('ses_1', at('2026-09-28T05:00:00.000Z'));
      expect((await repo().getSession('ses_1'))?.steppedUpAt).toEqual(
        at('2026-09-28T05:00:00.000Z'),
      );
    });

    const secret = Uint8Array.from({ length: 20 }, (_, i) => i + 1);
    const pending = (userId: string = 'usr_a') => ({
      userId,
      secret,
      status: 'PENDING' as const,
      lastUsedStep: 0,
      createdAt: at('2026-09-28T04:30:00.000Z'),
      confirmedAt: null,
    });

    it('keeps a pending factor until a code activates it, with its recovery codes', async () => {
      expect(await repo().getTotpFactor('usr_a')).toBeNull();
      expect(await repo().putPendingTotpFactor(pending())).toBe(true);
      expect(await repo().getTotpFactor('usr_a')).toEqual(pending());

      expect(
        await repo().activateTotpFactor('usr_a', {
          at: at('2026-09-28T04:31:00.000Z'),
          step: 100,
          recoveryCodeHashes: ['h1', 'h2'],
        }),
      ).toBe(true);
      expect(await repo().getTotpFactor('usr_a')).toEqual({
        ...pending(),
        status: 'ACTIVE',
        lastUsedStep: 100,
        confirmedAt: at('2026-09-28T04:31:00.000Z'),
      });
      expect((await repo().listRecoveryCodes('usr_a')).map((c) => c.hash).sort()).toEqual([
        'h1',
        'h2',
      ]);
      // Active: a new enrolment cannot replace it, and it cannot be activated twice.
      expect(await repo().putPendingTotpFactor(pending())).toBe(false);
      expect(
        await repo().activateTotpFactor('usr_a', {
          at: at('2026-09-28T04:32:00.000Z'),
          step: 101,
          recoveryCodeHashes: [],
        }),
      ).toBe(false);
    });

    it('accepts each TOTP step once, even when 10 uses race', async () => {
      await repo().putPendingTotpFactor(pending());
      await repo().activateTotpFactor('usr_a', {
        at: at('2026-09-28T04:31:00.000Z'),
        step: 100,
        recoveryCodeHashes: [],
      });
      expect(await repo().useTotpStep('usr_a', 100)).toBe(false);
      const results = await Promise.all(
        Array.from({ length: 10 }, () => repo().useTotpStep('usr_a', 101)),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await repo().useTotpStep('usr_a', 100)).toBe(false);
      expect(await repo().useTotpStep('usr_b', 200)).toBe(false);
    });

    it('uses a recovery code once, replaces them, and deletes them with the factor', async () => {
      await repo().putPendingTotpFactor(pending());
      await repo().activateTotpFactor('usr_a', {
        at: at('2026-09-28T04:31:00.000Z'),
        step: 100,
        recoveryCodeHashes: ['h1', 'h2'],
      });
      const [first] = await repo().listRecoveryCodes('usr_a');
      if (!first) throw new Error('no recovery codes');
      const uses = await Promise.all([
        repo().useRecoveryCode('usr_a', first.id, at('2026-09-28T05:00:00.000Z')),
        repo().useRecoveryCode('usr_a', first.id, at('2026-09-28T05:00:00.000Z')),
      ]);
      expect(uses.filter(Boolean)).toHaveLength(1);
      expect(await repo().useRecoveryCode('usr_b', first.id, at('2026-09-28T05:00:00.000Z'))).toBe(
        false,
      );
      expect(await repo().listRecoveryCodes('usr_a')).toHaveLength(1);

      await repo().replaceRecoveryCodes('usr_a', ['h3', 'h4', 'h5']);
      expect((await repo().listRecoveryCodes('usr_a')).map((c) => c.hash).sort()).toEqual([
        'h3',
        'h4',
        'h5',
      ]);

      await repo().deleteTotpFactor('usr_a');
      expect(await repo().getTotpFactor('usr_a')).toBeNull();
      expect(await repo().listRecoveryCodes('usr_a')).toEqual([]);
    });

    if (driver === 'postgres') {
      it('refuses reset: tests truncate the tables as the owner', async () => {
        await expect(repo().reset()).rejects.toThrow(/does not reset/);
      });
    }
  },
);
