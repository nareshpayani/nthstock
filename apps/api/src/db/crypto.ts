import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Column-level PII encryption and the blind index (T-189, ADR 0007 decision 6, spec
 * backend-core §4.1). Only `node:crypto`.
 *
 * - `encrypt` is AES-256-GCM. A ciphertext is `[key id: 1 byte][IV: 12][tag: 16][ciphertext]`, so
 *   keys can rotate: new values use the current key, old ones decrypt with the key their first
 *   byte names. `context` (e.g. `users.mobile`) is bound as additional authenticated data, so a
 *   ciphertext copied into another column does not decrypt.
 * - `blindIndex` is HMAC-SHA256 under a separate key, for equality lookups (the mobile) without
 *   decrypting: the same value always gives the same 32 bytes.
 *
 * Keys come from the environment:
 * - `PII_ENC_KEYS`: comma-separated `<id>:<base64 of 32 bytes>` entries, ids 1 to 255. The first
 *   entry is the current key (used for every new value); the others only decrypt. To rotate, put a
 *   new key first and keep the old ones until nothing is encrypted under them.
 * - `PII_HMAC_KEY`: base64 of 32 bytes. Changing it orphans every blind index, so it does not
 *   rotate this phase.
 *
 * Outside production, unset keys fall back to fixed development keys derived from public strings
 * (throwaway: they protect nothing). Production refuses to start without real keys, and refuses
 * the development keys if someone copies them in.
 */

/** AES-256 and HMAC-SHA256 key size. */
export const PII_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;

export type PiiKeys = {
  /** Every key that may decrypt, by id. */
  encryption: ReadonlyMap<number, Buffer>;
  /** The id new values are encrypted under. */
  currentKeyId: number;
  hmac: Buffer;
};

export type PiiCrypto = {
  /** AES-256-GCM under the current key; a fresh random IV every time. */
  encrypt(plaintext: string, context: string): Buffer;
  /** Throws `PiiDecryptError` for an unknown key id, a wrong context or any tampering. */
  decrypt(ciphertext: Uint8Array, context: string): string;
  /** HMAC-SHA256 of `value` in `domain` (e.g. `mobile`): stable, and useless without the key. */
  blindIndex(value: string, domain: string): Buffer;
};

export class PiiDecryptError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PiiDecryptError';
  }
}

/** The key id byte of a ciphertext (for rotation checks and tests). */
export const keyIdOf = (ciphertext: Uint8Array): number | undefined => ciphertext[0];

function decodeKey(value: string, what: string): Buffer {
  const trimmed = value.trim();
  const key = /^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)
    ? Buffer.from(trimmed, 'base64')
    : Buffer.alloc(0);
  if (key.length !== PII_KEY_BYTES) {
    throw new Error(`${what} must be base64 of exactly ${String(PII_KEY_BYTES)} bytes`);
  }
  return key;
}

/** Parses `PII_ENC_KEYS`; the first entry is the current key. */
export function parsePiiEncKeys(value: string): Pick<PiiKeys, 'encryption' | 'currentKeyId'> {
  const encryption = new Map<number, Buffer>();
  let currentKeyId: number | null = null;
  for (const entry of value.split(',')) {
    const colon = entry.indexOf(':');
    const idText = colon > 0 ? entry.slice(0, colon).trim() : '';
    if (!/^\d{1,3}$/.test(idText) || Number(idText) < 1 || Number(idText) > 255) {
      throw new Error('PII_ENC_KEYS entries must look like <id 1-255>:<base64 key>');
    }
    const id = Number(idText);
    if (encryption.has(id)) throw new Error(`PII_ENC_KEYS names key id ${idText} twice`);
    encryption.set(id, decodeKey(entry.slice(colon + 1), `PII_ENC_KEYS key ${idText}`));
    currentKeyId ??= id;
  }
  if (currentKeyId === null) throw new Error('PII_ENC_KEYS has no key');
  return { encryption, currentKeyId };
}

/** Throwaway development keys, derived from public strings. Never valid in production. */
export function devPiiKeys(): PiiKeys {
  const derive = (label: string) => createHash('sha256').update(`nthstock-dev:${label}`).digest();
  return {
    encryption: new Map([[1, derive('pii-enc-key-1')]]),
    currentKeyId: 1,
    hmac: derive('pii-hmac-key'),
  };
}

export type ResolvePiiKeysOptions = {
  /** `PII_ENC_KEYS`; blank counts as unset. */
  encKeys: string | undefined;
  /** `PII_HMAC_KEY`; blank counts as unset. */
  hmacKey: string | undefined;
  production: boolean;
  /** Told when the development keys are used (never given them). */
  onDevKeys?: () => void;
};

/**
 * The PII keys for this process: from the environment when set; otherwise the development keys,
 * except in production, which must set both and may not use the development ones.
 */
export function resolvePiiKeys({
  encKeys,
  hmacKey,
  production,
  onDevKeys,
}: ResolvePiiKeysOptions): PiiKeys {
  const enc = encKeys?.trim() ?? '';
  const hmac = hmacKey?.trim() ?? '';
  if (production && (enc === '' || hmac === '')) {
    throw new Error('PII_ENC_KEYS and PII_HMAC_KEY must be set in production');
  }
  const dev = devPiiKeys();
  if (enc === '' && hmac === '') {
    onDevKeys?.();
    return dev;
  }
  if (enc === '' || hmac === '') {
    throw new Error('Set both PII_ENC_KEYS and PII_HMAC_KEY, or neither (development keys)');
  }
  const keys: PiiKeys = { ...parsePiiEncKeys(enc), hmac: decodeKey(hmac, 'PII_HMAC_KEY') };
  if (production) {
    const devKeys = [...dev.encryption.values(), dev.hmac];
    const given = [...keys.encryption.values(), keys.hmac];
    if (given.some((key) => devKeys.some((devKey) => devKey.equals(key)))) {
      throw new Error('The development PII keys cannot be used in production');
    }
  }
  return keys;
}

export function createPiiCrypto(keys: PiiKeys): PiiCrypto {
  const current = keys.encryption.get(keys.currentKeyId);
  if (!current) throw new Error('The current PII key id has no key');
  return {
    encrypt(plaintext, context) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', current, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(context, 'utf8'));
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return Buffer.concat([Buffer.of(keys.currentKeyId), iv, cipher.getAuthTag(), body]);
    },

    decrypt(ciphertext, context) {
      const bytes = Buffer.from(ciphertext);
      if (bytes.length < HEADER_BYTES) throw new PiiDecryptError('Ciphertext is too short');
      const keyId = bytes[0] ?? 0;
      const key = keys.encryption.get(keyId);
      if (!key) throw new PiiDecryptError(`No PII key with id ${String(keyId)}`);
      const iv = bytes.subarray(1, 1 + IV_BYTES);
      const tag = bytes.subarray(1 + IV_BYTES, HEADER_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(tag);
      try {
        return Buffer.concat([
          decipher.update(bytes.subarray(HEADER_BYTES)),
          decipher.final(),
        ]).toString('utf8');
      } catch (error) {
        // Never the value or the key in the message.
        throw new PiiDecryptError('PII ciphertext failed authentication', { cause: error });
      }
    },

    blindIndex(value, domain) {
      return createHmac('sha256', keys.hmac).update(`${domain}\u0000${value}`, 'utf8').digest();
    },
  };
}

/** A mobile as it is indexed: digits only (the contract already allows only 10 digits). */
export const normaliseMobile = (mobile: string): string => mobile.replace(/\D/g, '');

/** The blind index of a mobile number, for `users.mobile_hash` and the Redis OTP keys. */
export const mobileHash = (crypto: PiiCrypto, mobile: string): Buffer =>
  crypto.blindIndex(normaliseMobile(mobile), 'mobile');
