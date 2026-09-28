import { describe, expect, it } from 'vitest';
import {
  PiiDecryptError,
  createPiiCrypto,
  devPiiKeys,
  keyIdOf,
  mobileHash,
  normaliseMobile,
  parsePiiEncKeys,
  resolvePiiKeys,
  type PiiKeys,
} from './crypto.js';

// Test-only keys: fixed bytes, not secrets.
const key = (fill: number) => Buffer.alloc(32, fill);
const b64 = (fill: number) => key(fill).toString('base64');

const keysV1: PiiKeys = { encryption: new Map([[1, key(1)]]), currentKeyId: 1, hmac: key(9) };
const keysV2: PiiKeys = {
  encryption: new Map([
    [2, key(2)],
    [1, key(1)],
  ]),
  currentKeyId: 2,
  hmac: key(9),
};

describe('PII encryption (T-189)', () => {
  it('round-trips a value and never stores the plaintext', () => {
    const pii = createPiiCrypto(keysV1);
    const ciphertext = pii.encrypt('9876543210', 'users.mobile');

    expect(pii.decrypt(ciphertext, 'users.mobile')).toBe('9876543210');
    expect(ciphertext.includes(Buffer.from('9876543210'))).toBe(false);
    expect(keyIdOf(ciphertext)).toBe(1);
    // key id + IV + tag + 10 bytes of ciphertext
    expect(ciphertext.length).toBe(1 + 12 + 16 + 10);
    expect(pii.decrypt(pii.encrypt('', 'users.name'), 'users.name')).toBe('');
    expect(pii.decrypt(pii.encrypt('Asha Rāo ✓', 'users.name'), 'users.name')).toBe('Asha Rāo ✓');
  });

  it('uses a fresh IV every time', () => {
    const pii = createPiiCrypto(keysV1);
    const a = pii.encrypt('same', 'users.name');
    const b = pii.encrypt('same', 'users.name');

    expect(a.equals(b)).toBe(false);
    expect(a.subarray(1, 13).equals(b.subarray(1, 13))).toBe(false);
  });

  it('detects tampering with the body, the tag, the IV or the key id', () => {
    const pii = createPiiCrypto(keysV2);
    const ciphertext = pii.encrypt('9876543210', 'users.mobile');
    for (const index of [0, 1, 13, ciphertext.length - 1]) {
      const tampered = Buffer.from(ciphertext);
      tampered[index] = (tampered[index] ?? 0) ^ 0x01;
      expect(() => pii.decrypt(tampered, 'users.mobile')).toThrow(PiiDecryptError);
    }
    expect(() => pii.decrypt(ciphertext.subarray(0, 20), 'users.mobile')).toThrow(/too short/);
  });

  it('binds the column: a ciphertext moved to another column does not decrypt', () => {
    const pii = createPiiCrypto(keysV1);
    const ciphertext = pii.encrypt('9876543210', 'users.mobile');

    expect(() => pii.decrypt(ciphertext, 'users.email')).toThrow(PiiDecryptError);
  });

  it('reads a value written under an older key id after rotation, and writes with the new one', () => {
    const before = createPiiCrypto(keysV1).encrypt('old@example.com', 'users.email');
    const rotated = createPiiCrypto(keysV2);

    expect(rotated.decrypt(before, 'users.email')).toBe('old@example.com');
    const after = rotated.encrypt('new@example.com', 'users.email');
    expect(keyIdOf(after)).toBe(2);
    // Without the new key, a value written under it cannot be read.
    expect(() => createPiiCrypto(keysV1).decrypt(after, 'users.email')).toThrow(
      /No PII key with id 2/,
    );
  });

  it('never puts the value in an error message', () => {
    const pii = createPiiCrypto(keysV1);
    const ciphertext = pii.encrypt('9876543210', 'users.mobile');
    ciphertext[ciphertext.length - 1] = (ciphertext.at(-1) ?? 0) ^ 0xff;

    try {
      pii.decrypt(ciphertext, 'users.mobile');
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('9876543210');
    }
  });
});

describe('blind index (T-189)', () => {
  it('is a stable HMAC-SHA256 that depends on the key and the domain', () => {
    const pii = createPiiCrypto(keysV1);
    const hash = mobileHash(pii, '9876543210');

    expect(hash).toHaveLength(32);
    expect(mobileHash(pii, '9876543210').equals(hash)).toBe(true);
    expect(mobileHash(createPiiCrypto(keysV2), '9876543210').equals(hash)).toBe(true);
    expect(mobileHash(pii, '9876543211').equals(hash)).toBe(false);
    expect(pii.blindIndex('9876543210', 'email').equals(hash)).toBe(false);
    expect(
      mobileHash(createPiiCrypto({ ...keysV1, hmac: key(8) }), '9876543210').equals(hash),
    ).toBe(false);
  });

  it('normalises the mobile to digits', () => {
    expect(normaliseMobile(' 98765 43210 ')).toBe('9876543210');
    const pii = createPiiCrypto(keysV1);
    expect(mobileHash(pii, ' 98765-43210').equals(mobileHash(pii, '9876543210'))).toBe(true);
  });
});

describe('PII keys from the environment (T-189)', () => {
  it('parses PII_ENC_KEYS with the first entry as the current key', () => {
    const parsed = parsePiiEncKeys(` 3:${b64(3)} , 1:${b64(1)}`);

    expect(parsed.currentKeyId).toBe(3);
    expect([...parsed.encryption.keys()]).toEqual([3, 1]);
    expect(parsed.encryption.get(1)).toEqual(key(1));
    // base64url works too
    expect(parsePiiEncKeys(`7:${key(250).toString('base64url')}`).encryption.get(7)).toEqual(
      key(250),
    );
  });

  it('rejects malformed key lists', () => {
    expect(() => parsePiiEncKeys('')).toThrow(/<id 1-255>:<base64 key>/);
    expect(() => parsePiiEncKeys(`0:${b64(1)}`)).toThrow(/<id 1-255>/);
    expect(() => parsePiiEncKeys(`256:${b64(1)}`)).toThrow(/<id 1-255>/);
    expect(() => parsePiiEncKeys(b64(1))).toThrow(/<id 1-255>/);
    expect(() => parsePiiEncKeys(`1:${b64(1)},1:${b64(2)}`)).toThrow(/twice/);
    expect(() => parsePiiEncKeys(`1:${Buffer.alloc(16).toString('base64')}`)).toThrow(
      /exactly 32 bytes/,
    );
    expect(() => parsePiiEncKeys('1:not base64!')).toThrow(/exactly 32 bytes/);
  });

  it('falls back to the development keys outside production, and says so', () => {
    let told = 0;
    const keys = resolvePiiKeys({
      encKeys: ' ',
      hmacKey: undefined,
      production: false,
      onDevKeys: () => (told += 1),
    });

    expect(keys).toEqual(devPiiKeys());
    expect(told).toBe(1);
    // Deterministic: data written in one dev run decrypts in the next.
    const ciphertext = createPiiCrypto(devPiiKeys()).encrypt('x', 'c');
    expect(createPiiCrypto(keys).decrypt(ciphertext, 'c')).toBe('x');
  });

  it('refuses to start in production without keys, or with the development keys', () => {
    expect(() =>
      resolvePiiKeys({ encKeys: undefined, hmacKey: undefined, production: true }),
    ).toThrow('PII_ENC_KEYS and PII_HMAC_KEY must be set in production');
    expect(() => resolvePiiKeys({ encKeys: `1:${b64(1)}`, hmacKey: '', production: true })).toThrow(
      /must be set in production/,
    );
    const dev = devPiiKeys();
    const devEnc = `1:${dev.encryption.get(1)?.toString('base64') ?? ''}`;
    expect(() => resolvePiiKeys({ encKeys: devEnc, hmacKey: b64(9), production: true })).toThrow(
      /development PII keys cannot be used in production/,
    );
    expect(() =>
      resolvePiiKeys({
        encKeys: `1:${b64(1)}`,
        hmacKey: dev.hmac.toString('base64'),
        production: true,
      }),
    ).toThrow(/development PII keys/);

    expect(resolvePiiKeys({ encKeys: `4:${b64(4)}`, hmacKey: b64(9), production: true })).toEqual({
      encryption: new Map([[4, key(4)]]),
      currentKeyId: 4,
      hmac: key(9),
    });
  });

  it('needs both keys or neither', () => {
    expect(() =>
      resolvePiiKeys({ encKeys: `1:${b64(1)}`, hmacKey: undefined, production: false }),
    ).toThrow(/both PII_ENC_KEYS and PII_HMAC_KEY, or neither/);
    expect(() => resolvePiiKeys({ encKeys: '', hmacKey: 'short', production: false })).toThrow(
      /or neither/,
    );
    expect(() =>
      resolvePiiKeys({ encKeys: `1:${b64(1)}`, hmacKey: 'short', production: false }),
    ).toThrow(/PII_HMAC_KEY must be base64 of exactly 32 bytes/);
  });

  it('needs the current key id to have a key', () => {
    expect(() => createPiiCrypto({ encryption: new Map(), currentKeyId: 1, hmac: key(9) })).toThrow(
      /current PII key id has no key/,
    );
  });
});
