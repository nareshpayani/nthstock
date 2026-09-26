import { describe, expect, it } from 'vitest';
import { createArgon2PinHasher } from './pinHasher.js';

const hasher = createArgon2PinHasher();

describe('Argon2id PIN hasher', () => {
  it('hashes with Argon2id and a fresh salt, and verifies only the right PIN', async () => {
    const a = await hasher.hash('4821');
    const b = await hasher.hash('4821');

    expect(a).toMatch(/^\$argon2id\$/);
    expect(a).not.toBe(b);
    expect(await hasher.verify(a, '4821')).toBe(true);
    expect(await hasher.verify(a, '4822')).toBe(false);
  });

  it('treats a corrupt stored hash as a wrong PIN', async () => {
    expect(await hasher.verify('not-a-hash', '4821')).toBe(false);
  });
});
