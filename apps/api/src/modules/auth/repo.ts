import type { OtpPurpose } from '@nthstock/contracts';

/** One outstanding OTP. Only a hash of the code is stored. */
export type OtpChallenge = {
  requestId: string;
  mobile: string;
  purpose: OtpPurpose;
  otpHash: string;
  failures: number;
  createdAt: Date;
  expiresAt: Date;
};

/**
 * Storage seam for auth state (ADR 0004 §3). In-memory in the mock phase; Redis (OTPs, throttles,
 * sessions) and Postgres (devices, PINs) implementations replace it later without changes to the
 * services. Methods that must be atomic under concurrency (counters) are single calls here so a
 * Redis version can use INCR.
 */
export interface AuthRepo {
  /** Stores the mobile's current OTP, replacing any earlier one (only the latest OTP works). */
  putOtpChallenge(challenge: OtpChallenge): Promise<void>;
  getOtpChallenge(mobile: string): Promise<OtpChallenge | null>;
  /** Adds one wrong attempt; resolves to the new count, or null when the challenge is gone. */
  recordOtpFailure(mobile: string, requestId: string): Promise<number | null>;
  /** Removes the challenge if it is still `requestId`; resolves true when this call removed it. */
  consumeOtpChallenge(mobile: string, requestId: string): Promise<boolean>;
  /** When an OTP was last requested for the mobile (resend throttle). */
  getLastOtpRequestAt(mobile: string): Promise<Date | null>;
  setLastOtpRequestAt(mobile: string, at: Date): Promise<void>;
  /** Drops all state. Tests call it between cases. */
  reset(): Promise<void>;
}

const copyChallenge = (c: OtpChallenge): OtpChallenge => ({
  ...c,
  createdAt: new Date(c.createdAt),
  expiresAt: new Date(c.expiresAt),
});

export function createMemoryAuthRepo(): AuthRepo {
  const challenges = new Map<string, OtpChallenge>();
  const lastRequest = new Map<string, Date>();

  return {
    putOtpChallenge: (challenge) => {
      challenges.set(challenge.mobile, copyChallenge(challenge));
      return Promise.resolve();
    },
    getOtpChallenge: (mobile) => {
      const found = challenges.get(mobile);
      return Promise.resolve(found ? copyChallenge(found) : null);
    },
    recordOtpFailure: (mobile, requestId) => {
      const found = challenges.get(mobile);
      if (!found || found.requestId !== requestId) return Promise.resolve(null);
      found.failures += 1;
      return Promise.resolve(found.failures);
    },
    consumeOtpChallenge: (mobile, requestId) => {
      const found = challenges.get(mobile);
      if (!found || found.requestId !== requestId) return Promise.resolve(false);
      challenges.delete(mobile);
      return Promise.resolve(true);
    },
    getLastOtpRequestAt: (mobile) => {
      const at = lastRequest.get(mobile);
      return Promise.resolve(at ? new Date(at) : null);
    },
    setLastOtpRequestAt: (mobile, at) => {
      lastRequest.set(mobile, new Date(at));
      return Promise.resolve();
    },
    reset: () => {
      challenges.clear();
      lastRequest.clear();
      return Promise.resolve();
    },
  };
}
