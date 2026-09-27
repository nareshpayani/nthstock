import { PROFILE_ABOUT_MAX } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { SECTOR_ABOUT, profileAbout } from './profile.js';
import { SECTORS } from './sectors.js';

describe('profileAbout', () => {
  it('names the company, size, sector, listing and every index', () => {
    const about = profileAbout({
      name: 'Infosys Ltd',
      sector: 'Information Technology',
      capCategory: 'LARGE',
      exchange: 'NSE',
      indices: [
        { symbol: 'NIFTY50', name: 'NIFTY 50' },
        { symbol: 'SENSEX', name: 'SENSEX' },
        { symbol: 'NIFTYIT', name: 'NIFTY IT' },
      ],
    });
    expect(about).toMatch(
      /^Infosys Ltd is a large-cap company in the Information Technology sector, listed on the National Stock Exchange \(NSE\)\./,
    );
    expect(about).toContain('constituent of the NIFTY 50, SENSEX and NIFTY IT indices.');
    expect(about).toContain(SECTOR_ABOUT['Information Technology']);
    expect(about).toMatch(/not an official company description\.$/);
  });

  it('handles one index and none', () => {
    const base = {
      name: 'Acme Ltd',
      sector: 'Cement',
      capCategory: 'SMALL',
      exchange: 'BSE',
    } as const;
    expect(
      profileAbout({ ...base, indices: [{ symbol: 'X', name: 'NIFTY MIDCAP 100' }] }),
    ).toContain('constituent of the NIFTY MIDCAP 100 index.');
    const none = profileAbout({ ...base, indices: [] });
    expect(none).toContain('a small-cap company in the Cement sector, listed on BSE.');
    expect(none).toContain('not a constituent of any of the headline indices');
  });

  it('describes every sector and stays within the contract limit', () => {
    for (const sector of SECTORS) {
      expect(SECTOR_ABOUT[sector].length).toBeGreaterThan(20);
      const about = profileAbout({
        name: 'A'.repeat(120),
        sector,
        capCategory: 'MID',
        exchange: 'NSE',
        indices: Array.from({ length: 5 }, (_, i) => ({
          symbol: `IX${String(i)}`,
          name: 'N'.repeat(60),
        })),
      });
      expect(about.length).toBeLessThanOrEqual(PROFILE_ABOUT_MAX);
    }
  });
});
