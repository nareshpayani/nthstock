import { Exchange, KycStatus, LedgerEntryType } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { LEDGER_ENTRY_TYPES } from './schema/paper.js';
import { KYC_STATUSES } from './schema/users.js';
import { EXCHANGES } from './schema/watchlists.js';

// Lists the schema repeats from packages/contracts (drizzle-kit cannot load that package).
describe('schema enums', () => {
  it('checks users.kyc_status against the contract KycStatus', () => {
    expect([...KYC_STATUSES]).toEqual(KycStatus.options);
  });

  it('checks ledger_entries.type against the contract LedgerEntryType', () => {
    expect([...LEDGER_ENTRY_TYPES]).toEqual(LedgerEntryType.options);
  });

  it('checks watchlist_items.exchange against the contract Exchange', () => {
    expect([...EXCHANGES]).toEqual(Exchange.options);
  });
});
