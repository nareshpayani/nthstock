import { Exchange, KycStatus } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { KYC_STATUSES } from './schema/users.js';
import { EXCHANGES } from './schema/watchlists.js';

// Lists the schema repeats from packages/contracts (drizzle-kit cannot load that package).
describe('schema enums', () => {
  it('checks users.kyc_status against the contract KycStatus', () => {
    expect([...KYC_STATUSES]).toEqual(KycStatus.options);
  });

  it('checks watchlist_items.exchange against the contract Exchange', () => {
    expect([...EXCHANGES]).toEqual(Exchange.options);
  });
});
