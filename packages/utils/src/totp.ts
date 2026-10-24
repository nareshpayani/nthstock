/**
 * RFC 6238 time-based one-time passwords (NSTOCK-0213, spec backend-core §7.4): HMAC-SHA1, 6
 * digits, a 30 s step, accepting one step either side for clock drift. Built on Web Crypto
 * (`crypto.subtle`), which Node 22 and every browser have, so apps/api and the MSW mock share one
 * implementation and no library is needed. Any authenticator app (Google Authenticator, Authy,
 * 1Password, Microsoft Authenticator) reads the `otpauth://` URI and produces the same codes.
 */

/** Seconds per TOTP step. */
export const TOTP_STEP_SEC = 30;
/** Digits per code. */
export const TOTP_DIGITS = 6;
/** Steps accepted either side of now, for a phone clock that runs a little fast or slow. */
export const TOTP_WINDOW = 1;
/** Bytes of a new secret: 160 bits, as RFC 4226 recommends for HMAC-SHA1. */
export const TOTP_SECRET_BYTES = 20;

// The package compiles without DOM types; this is the slice of Web Crypto it uses.
type HmacKey = object;
type SubtleSlice = {
  importKey(
    format: 'raw',
    key: Uint8Array,
    algorithm: { name: 'HMAC'; hash: 'SHA-1' },
    extractable: false,
    usages: ['sign'],
  ): Promise<HmacKey>;
  sign(algorithm: 'HMAC', key: HmacKey, data: Uint8Array): Promise<ArrayBuffer>;
};
type CryptoSlice = { subtle: SubtleSlice; getRandomValues<T extends Uint8Array>(array: T): T };

const webCrypto = (): CryptoSlice => (globalThis as unknown as { crypto: CryptoSlice }).crypto;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding, as authenticator apps expect a setup key. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Decodes base32, ignoring case, spaces, dashes and padding (a setup key typed by hand). Throws a
 * `RangeError` on any other character.
 */
export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new RangeError(`Not a base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** A new random secret (`TOTP_SECRET_BYTES`). */
export function newTotpSecret(): Uint8Array {
  return webCrypto().getRandomValues(new Uint8Array(TOTP_SECRET_BYTES));
}

/** The TOTP step an instant falls in. */
export function totpStep(at: Date | number): number {
  return Math.floor(new Date(at).getTime() / 1000 / TOTP_STEP_SEC);
}

/** RFC 4226 HOTP: the code for one counter value. */
export async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const message = new Uint8Array(8);
  // 8-byte big-endian counter; steps fit well inside 2^53.
  let rest = counter;
  for (let i = 7; i >= 0; i -= 1) {
    message[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  const { subtle } = webCrypto();
  const key = await subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, [
    'sign',
  ]);
  const mac = new Uint8Array(await subtle.sign('HMAC', key, message));
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** The code an authenticator app shows at `at`. */
export function totpCode(secret: Uint8Array, at: Date | number): Promise<string> {
  return hotp(secret, totpStep(at));
}

/**
 * Checks a code against the steps around `at` (`TOTP_WINDOW` either side) and resolves to the step
 * it matched, or null. Pass `afterStep`, the last step this secret accepted, to refuse a replay:
 * a matching step at or before it is refused (RFC 6238 §5.2, ASVS 2.8.4).
 */
export async function verifyTotp(
  secret: Uint8Array,
  code: string,
  at: Date | number,
  { afterStep = -1 }: { afterStep?: number } = {},
): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const now = totpStep(at);
  for (let step = now - TOTP_WINDOW; step <= now + TOTP_WINDOW; step += 1) {
    if (step <= afterStep) continue;
    if ((await hotp(secret, step)) === code) return step;
  }
  return null;
}

/**
 * The `otpauth://totp/…` URI authenticator apps import (a QR code of it, or the link on a phone).
 * `label` is what the app lists under the issuer; never put a full mobile number in it.
 */
export function otpauthUri({
  issuer,
  label,
  secret,
}: {
  issuer: string;
  label: string;
  secret: Uint8Array;
}): string {
  const params = [
    `secret=${base32Encode(secret)}`,
    `issuer=${encodeURIComponent(issuer)}`,
    'algorithm=SHA1',
    `digits=${String(TOTP_DIGITS)}`,
    `period=${String(TOTP_STEP_SEC)}`,
  ];
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?${params.join('&')}`;
}

/** A setup key in groups of four for reading aloud or typing: `JBSW Y3DP EHPK 3PXP`. */
export const groupSetupKey = (key: string): string => key.replace(/(.{4})(?=.)/g, '$1 ');
