import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  groupSetupKey,
  hotp,
  newTotpSecret,
  otpauthUri,
  totpCode,
  totpStep,
  verifyTotp,
} from './totp.js';

const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

// RFC 6238 Appendix B (SHA-1), the last 6 of its 8 digits.
const RFC_SECRET = ascii('12345678901234567890');
const RFC_VECTORS: [number, string][] = [
  [59, '287082'],
  [1_111_111_109, '081804'],
  [1_111_111_111, '050471'],
  [1_234_567_890, '005924'],
  [2_000_000_000, '279037'],
  [20_000_000_000, '353130'],
];

describe('TOTP (NSTOCK-0213)', () => {
  it.each(RFC_VECTORS)('matches RFC 6238 at %i s', async (seconds, code) => {
    expect(await totpCode(RFC_SECRET, seconds * 1000)).toBe(code);
  });

  it('matches RFC 4226 HOTP for the first counters', async () => {
    const codes = await Promise.all([0, 1, 2, 9].map((counter) => hotp(RFC_SECRET, counter)));
    expect(codes).toEqual(['755224', '287082', '359152', '520489']);
  });

  it('accepts one step either side and reports the step it matched', async () => {
    const at = 1_700_000_000_000;
    const now = totpStep(at);
    const previous = await hotp(RFC_SECRET, now - 1);
    const next = await hotp(RFC_SECRET, now + 1);
    expect(await verifyTotp(RFC_SECRET, previous, at)).toBe(now - 1);
    expect(await verifyTotp(RFC_SECRET, next, at)).toBe(now + 1);
    expect(await verifyTotp(RFC_SECRET, await hotp(RFC_SECRET, now + 2), at)).toBeNull();
    expect(await verifyTotp(RFC_SECRET, '12345', at)).toBeNull();
  });

  it('refuses a step at or before the last one accepted (replay)', async () => {
    const at = 1_700_000_000_000;
    const code = await totpCode(RFC_SECRET, at);
    const step = await verifyTotp(RFC_SECRET, code, at);
    expect(step).toBe(totpStep(at));
    expect(await verifyTotp(RFC_SECRET, code, at, { afterStep: step ?? 0 })).toBeNull();
  });

  it('round-trips base32 and reads a hand-typed key', () => {
    expect(base32Encode(ascii('Hello!'))).toBe('JBSWY3DPEE');
    const secret = newTotpSecret();
    expect(secret).toHaveLength(20);
    const key = base32Encode(secret);
    expect(key).toHaveLength(32);
    expect(base32Decode(groupSetupKey(key).toLowerCase())).toEqual(secret);
    expect(() => base32Decode('ABC1')).toThrow(RangeError);
  });

  it('builds the otpauth URI authenticator apps import', () => {
    expect(otpauthUri({ issuer: 'nthstock', label: '******3210', secret: RFC_SECRET })).toBe(
      'otpauth://totp/nthstock:******3210?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=nthstock&algorithm=SHA1&digits=6&period=30',
    );
    expect(groupSetupKey('GEZDGNBVGY3TQOJQ')).toBe('GEZD GNBV GY3T QOJQ');
  });
});
