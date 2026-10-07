import { OTP_RESEND_AFTER_SEC, OtpPurpose } from '@nthstock/contracts';
import type { Redis } from 'ioredis';
import { mobileHash, type PiiCrypto } from '../../db/crypto.js';
import type { OtpChallenge, OtpStore } from './repo.js';

/** Where apps/api keeps its keys in Redis unless told otherwise (tests use their own). */
export const DEFAULT_REDIS_KEY_PREFIX = 'nthstock:';

export type RedisOtpStoreOptions = {
  redis: Redis;
  /** For the blind index that names the keys: no mobile number ever appears in a key. */
  pii: PiiCrypto;
  /** Key namespace; default `nthstock:`. */
  prefix?: string;
};

// Both scripts act only while the stored challenge is still `requestId` (ARGV[1]), atomically.
/** Adds one failure and returns the new count, or nil when the challenge is gone or replaced. */
const RECORD_FAILURE = `
if redis.call('HGET', KEYS[1], 'requestId') == ARGV[1] then
  return redis.call('HINCRBY', KEYS[1], 'failures', 1)
end
return false`;

/** Deletes the challenge and returns 1, or 0 when it is gone or replaced. */
const CONSUME = `
if redis.call('HGET', KEYS[1], 'requestId') == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

const toInt = (value: string | undefined) =>
  value !== undefined && /^\d+$/.test(value) ? Number(value) : null;

/**
 * OTP challenges and the resend throttle in Redis (T-193, spec backend-core §7.1).
 *
 * - `<prefix>otp:<blind index>` is a hash per mobile: the request id, the purpose, the OTP's hash
 *   (never the OTP), the failure count and the times. Its TTL is the challenge's lifetime
 *   (`OTP_TTL_SEC`), so an abandoned challenge disappears on its own. The mobile itself is not
 *   stored: callers already have it.
 * - `<prefix>otp:resend:<blind index>` holds when the last OTP was requested, for
 *   `OTP_RESEND_AFTER_SEC`.
 * - Failures go up with HINCRBY and a challenge is consumed with a check-and-DEL, each in one Lua
 *   script, so concurrent verifies count exactly and at most one consumes.
 *
 * Expiry is still judged by the service against its clock (`expiresAt`); the TTL only removes
 * what nobody will use, so a test clock that runs ahead or behind sees the same results as memory.
 */
export function createRedisOtpStore({
  redis,
  pii,
  prefix = DEFAULT_REDIS_KEY_PREFIX,
}: RedisOtpStoreOptions): OtpStore {
  const index = (mobile: string) => mobileHash(pii, mobile).toString('hex');
  const challengeKey = (mobile: string) => `${prefix}otp:${index(mobile)}`;
  const resendKey = (mobile: string) => `${prefix}otp:resend:${index(mobile)}`;

  return {
    async putOtpChallenge(challenge) {
      const key = challengeKey(challenge.mobile);
      const ttlMs = Math.max(1, challenge.expiresAt.getTime() - challenge.createdAt.getTime());
      const results = await redis
        .multi()
        .del(key)
        .hset(key, {
          requestId: challenge.requestId,
          purpose: challenge.purpose,
          otpHash: challenge.otpHash,
          failures: String(challenge.failures),
          createdAt: String(challenge.createdAt.getTime()),
          expiresAt: String(challenge.expiresAt.getTime()),
        })
        .pexpire(key, ttlMs)
        .exec();
      const failed = results?.find(([error]) => error);
      if (!results || failed) throw failed?.[0] ?? new Error('Storing the OTP challenge failed');
    },

    async getOtpChallenge(mobile) {
      const stored = await redis.hgetall(challengeKey(mobile));
      const purpose = OtpPurpose.safeParse(stored['purpose']);
      const failures = toInt(stored['failures']);
      const createdAt = toInt(stored['createdAt']);
      const expiresAt = toInt(stored['expiresAt']);
      const { requestId, otpHash } = stored;
      if (
        !requestId ||
        !otpHash ||
        !purpose.success ||
        failures === null ||
        createdAt === null ||
        expiresAt === null
      ) {
        return null;
      }
      return {
        requestId,
        mobile,
        purpose: purpose.data,
        otpHash,
        failures,
        createdAt: new Date(createdAt),
        expiresAt: new Date(expiresAt),
      } satisfies OtpChallenge;
    },

    async recordOtpFailure(mobile, requestId) {
      const count = await redis.eval(RECORD_FAILURE, 1, challengeKey(mobile), requestId);
      return typeof count === 'number' ? count : null;
    },

    async consumeOtpChallenge(mobile, requestId) {
      return (await redis.eval(CONSUME, 1, challengeKey(mobile), requestId)) === 1;
    },

    async getLastOtpRequestAt(mobile) {
      const at = toInt((await redis.get(resendKey(mobile))) ?? undefined);
      return at === null ? null : new Date(at);
    },

    async setLastOtpRequestAt(mobile, at) {
      await redis.set(resendKey(mobile), String(at.getTime()), 'PX', OTP_RESEND_AFTER_SEC * 1000);
    },

    /** Tests only: deletes this store's keys (its prefix). */
    async reset() {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}otp:*`, 'COUNT', 500);
        cursor = next;
        if (keys.length > 0) await redis.del(...keys);
      } while (cursor !== '0');
    },
  };
}
