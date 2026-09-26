import { hash, verify, type Algorithm } from '@node-rs/argon2';

/** Hashes and checks PINs. Argon2id in the app; the seam lets a test count calls. */
export interface PinHasher {
  hash(pin: string): Promise<string>;
  verify(hash: string, pin: string): Promise<boolean>;
}

/** Argon2id with the OWASP minimum (19 MiB, 2 passes, 1 lane); parameters live in the hash. */
export const ARGON2_OPTIONS = {
  // `Algorithm` is an ambient const enum, which isolated modules cannot read; 2 is Argon2id.
  algorithm: 2 as Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function createArgon2PinHasher(): PinHasher {
  return {
    hash: (pin) => hash(pin, ARGON2_OPTIONS),
    verify: async (stored, pin) => {
      try {
        return await verify(stored, pin);
      } catch {
        return false;
      }
    },
  };
}
