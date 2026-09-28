import { OTP_RESEND_AFTER_SEC, OTP_TTL_SEC } from '@nthstock/contracts';
import { setTimeout as sleep } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { createPiiCrypto, devPiiKeys, mobileHash } from '../../db/crypto.js';
import { describeRepoConformance } from '../../test/conformance.js';
import { uniqueChannel } from '../../test/testRedis.js';
import { createRedisOtpStore } from './redisOtpStore.js';
import { createMemoryOtpStore, type OtpChallenge } from './repo.js';

// The OTP store conformance suite (T-193): the memory store and the Redis store behave the same.

const pii = createPiiCrypto(devPiiKeys());
const MOBILE = '9876543210';
const created = new Date('2026-09-28T04:30:00.000Z');

const challenge = (requestId: string, mobile = MOBILE): OtpChallenge => ({
  requestId,
  mobile,
  purpose: 'LOGIN',
  otpHash: `hash-of-${requestId}`,
  failures: 0,
  createdAt: created,
  expiresAt: new Date(created.getTime() + OTP_TTL_SEC * 1000),
});

let prefix = '';

describeRepoConformance(
  'OTP store',
  {
    memory: () => createMemoryOtpStore(),
    redis: (redis) => {
      // Each test its own namespace on the shared server.
      prefix = `${uniqueChannel('test:otp')}:`;
      return createRedisOtpStore({ redis, pii, prefix });
    },
  },
  ({ driver, repo, redis }) => {
    it('stores a challenge per mobile and reads it back; an unknown mobile has none', async () => {
      await repo().putOtpChallenge({ ...challenge('otp_1'), purpose: 'UNLOCK_PIN', failures: 2 });

      expect(await repo().getOtpChallenge(MOBILE)).toEqual({
        ...challenge('otp_1'),
        purpose: 'UNLOCK_PIN',
        failures: 2,
      });
      expect(await repo().getOtpChallenge('9123456789')).toBeNull();
    });

    it('keeps only the latest challenge of a mobile', async () => {
      await repo().putOtpChallenge(challenge('otp_1'));
      await repo().recordOtpFailure(MOBILE, 'otp_1');
      await repo().putOtpChallenge(challenge('otp_2'));

      expect(await repo().getOtpChallenge(MOBILE)).toEqual(challenge('otp_2'));
      expect(await repo().recordOtpFailure(MOBILE, 'otp_1')).toBeNull();
      expect(await repo().consumeOtpChallenge(MOBILE, 'otp_1')).toBe(false);
      expect(await repo().getOtpChallenge(MOBILE)).toEqual(challenge('otp_2'));
    });

    it('counts failures for the current request only', async () => {
      await repo().putOtpChallenge(challenge('otp_1'));

      expect(await repo().recordOtpFailure(MOBILE, 'otp_1')).toBe(1);
      expect(await repo().recordOtpFailure(MOBILE, 'otp_1')).toBe(2);
      expect(await repo().recordOtpFailure(MOBILE, 'otp_other')).toBeNull();
      expect(await repo().recordOtpFailure('9123456789', 'otp_1')).toBeNull();
      expect((await repo().getOtpChallenge(MOBILE))?.failures).toBe(2);
    });

    it('counts 5 concurrent failures to exactly 5', async () => {
      await repo().putOtpChallenge(challenge('otp_1'));

      const counts = await Promise.all(
        Array.from({ length: 5 }, () => repo().recordOtpFailure(MOBILE, 'otp_1')),
      );

      expect(counts.toSorted()).toEqual([1, 2, 3, 4, 5]);
    });

    it('consumes a challenge once; concurrent consumers see one success', async () => {
      await repo().putOtpChallenge(challenge('otp_1'));

      const results = await Promise.all(
        Array.from({ length: 5 }, () => repo().consumeOtpChallenge(MOBILE, 'otp_1')),
      );

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await repo().getOtpChallenge(MOBILE)).toBeNull();
      expect(await repo().consumeOtpChallenge(MOBILE, 'otp_1')).toBe(false);
      expect(await repo().recordOtpFailure(MOBILE, 'otp_1')).toBeNull();
    });

    it('keeps challenges of different mobiles apart', async () => {
      await repo().putOtpChallenge(challenge('otp_1'));
      await repo().putOtpChallenge(challenge('otp_2', '9123456789'));
      await repo().consumeOtpChallenge(MOBILE, 'otp_1');

      expect(await repo().getOtpChallenge(MOBILE)).toBeNull();
      expect(await repo().getOtpChallenge('9123456789')).toEqual(challenge('otp_2', '9123456789'));
    });

    it('remembers when an OTP was last requested, per mobile', async () => {
      expect(await repo().getLastOtpRequestAt(MOBILE)).toBeNull();

      await repo().setLastOtpRequestAt(MOBILE, created);
      await repo().setLastOtpRequestAt(MOBILE, new Date('2026-09-28T04:31:00.000Z'));

      expect(await repo().getLastOtpRequestAt(MOBILE)).toEqual(
        new Date('2026-09-28T04:31:00.000Z'),
      );
      expect(await repo().getLastOtpRequestAt('9123456789')).toBeNull();
    });

    it('forgets everything on reset', async () => {
      await repo().putOtpChallenge(challenge('otp_1'));
      await repo().setLastOtpRequestAt(MOBILE, created);

      await repo().reset();

      expect(await repo().getOtpChallenge(MOBILE)).toBeNull();
      expect(await repo().getLastOtpRequestAt(MOBILE)).toBeNull();
    });

    if (driver === 'redis') {
      it('lets a challenge disappear after its TTL (Redis only)', async () => {
        const shortLived = { ...challenge('otp_1'), expiresAt: new Date(created.getTime() + 300) };
        await repo().putOtpChallenge(shortLived);
        expect(await repo().getOtpChallenge(MOBILE)).toEqual(shortLived);

        await sleep(450);

        expect(await repo().getOtpChallenge(MOBILE)).toBeNull();
        expect(await repo().recordOtpFailure(MOBILE, 'otp_1')).toBeNull();
        expect(await repo().consumeOtpChallenge(MOBILE, 'otp_1')).toBe(false);
      });

      it('gives a challenge OTP_TTL_SEC and the throttle OTP_RESEND_AFTER_SEC (Redis only)', async () => {
        await repo().putOtpChallenge(challenge('otp_1'));
        await repo().setLastOtpRequestAt(MOBILE, created);
        const hash = mobileHash(pii, MOBILE).toString('hex');

        const challengeTtl = await redis().pttl(`${prefix}otp:${hash}`);
        const resendTtl = await redis().pttl(`${prefix}otp:resend:${hash}`);
        expect(challengeTtl).toBeGreaterThan(OTP_TTL_SEC * 1000 - 5_000);
        expect(challengeTtl).toBeLessThanOrEqual(OTP_TTL_SEC * 1000);
        expect(resendTtl).toBeGreaterThan(OTP_RESEND_AFTER_SEC * 1000 - 5_000);
        expect(resendTtl).toBeLessThanOrEqual(OTP_RESEND_AFTER_SEC * 1000);
      });

      it('names keys by the blind index and stores no mobile or OTP (Redis only)', async () => {
        await repo().putOtpChallenge(challenge('otp_1'));
        await repo().setLastOtpRequestAt(MOBILE, created);

        const keys = await redis().keys(`${prefix}*`);
        expect(keys.toSorted()).toEqual(
          [
            `${prefix}otp:${mobileHash(pii, MOBILE).toString('hex')}`,
            `${prefix}otp:resend:${mobileHash(pii, MOBILE).toString('hex')}`,
          ].toSorted(),
        );
        for (const key of keys) expect(key).not.toContain(MOBILE);
        const stored = await redis().hgetall(keys.find((key) => !key.includes('resend')) ?? '');
        expect(JSON.stringify(stored)).not.toContain(MOBILE);
        expect(Object.keys(stored).toSorted()).toEqual(
          ['createdAt', 'expiresAt', 'failures', 'otpHash', 'purpose', 'requestId'].toSorted(),
        );
      });

      it('reads a damaged challenge as none (Redis only)', async () => {
        await repo().putOtpChallenge(challenge('otp_1'));
        const key = `${prefix}otp:${mobileHash(pii, MOBILE).toString('hex')}`;
        await redis().hset(key, 'purpose', 'NOT_A_PURPOSE');

        expect(await repo().getOtpChallenge(MOBILE)).toBeNull();
      });
    }
  },
);
