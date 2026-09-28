import { KycStatus } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { KYC_STATUSES } from './schema/users.js';

// Lists the schema repeats from packages/contracts (drizzle-kit cannot load that package).
describe('schema enums', () => {
  it('checks users.kyc_status against the contract KycStatus', () => {
    expect([...KYC_STATUSES]).toEqual(KycStatus.options);
  });
});
