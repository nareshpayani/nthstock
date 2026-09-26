import { fixedClock, fromIst } from '@nthstock/utils';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { MarketSessionContext, type MarketSession } from '@/shared/lib/marketSessionContext';
import { useMarketOpen } from './useMarketOpen';

const at = (date: string, hh: number, mm: number) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return fixedClock(fromIst(y, m, d, hh * 60 + mm));
};

function openAt(session: MarketSession) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MarketSessionContext.Provider value={session}>{children}</MarketSessionContext.Provider>
  );
  return renderHook(() => useMarketOpen(), { wrapper }).result.current;
}

describe('useMarketOpen', () => {
  it('is true inside NSE hours on a trading day', () => {
    expect(openAt({ clock: at('2026-09-25', 10, 0), alwaysOpen: false })).toBe(true);
  });

  it('is false before the open, on a weekend and on a holiday', () => {
    expect(openAt({ clock: at('2026-09-25', 9, 10), alwaysOpen: false })).toBe(false);
    expect(openAt({ clock: at('2026-09-26', 11, 0), alwaysOpen: false })).toBe(false);
    expect(openAt({ clock: at('2026-10-02', 11, 0), alwaysOpen: false })).toBe(false);
  });

  it('is true at any hour when the mock market is forced open', () => {
    expect(openAt({ clock: at('2026-10-02', 23, 0), alwaysOpen: true })).toBe(true);
  });
});
