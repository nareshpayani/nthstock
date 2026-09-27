import type { Holding } from '@nthstock/contracts';
import { holdingValues } from '@nthstock/paperEngine';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { StoryApiProviders } from '@/mocks/storyApi';
import { PortfolioPage, type PortfolioSearch } from './PortfolioPage';

/** A made-up holding valued with the paper engine's own math. */
const holding = (
  token: number,
  symbol: string,
  qty: number,
  avg: number,
  ltp: number,
  prevClose: number,
): Holding => ({
  token,
  symbol,
  exchange: 'NSE',
  ...holdingValues({ qty, investedValue: qty * avg }, ltp, prevClose),
});

const HOLDINGS: Holding[] = [
  holding(341249, 'HDFCBANK', 12, 1_642_30, 1_729_00, 1_718_45),
  holding(408065, 'INFY', 25, 1_455_10, 1_512_35, 1_520_00),
  holding(2953217, 'TCS', 6, 3_910_00, 3_795_40, 3_780_10),
];

function Demo({ holdings, initial }: { holdings: Holding[]; initial: PortfolioSearch }) {
  const [search, setSearch] = useState<PortfolioSearch>(initial);
  return (
    <StoryApiProviders routes={{ '/v1/holdings': { items: holdings } }}>
      <PortfolioPage
        search={search}
        onSearchChange={(patch) => setSearch((current) => ({ ...current, ...patch }))}
      />
    </StoryApiProviders>
  );
}

const meta = {
  title: 'Holdings/PortfolioPage',
  component: Demo,
  args: { holdings: HOLDINGS, initial: {} },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The live summary over the holdings table, sorted A–Z. */
export const WithHoldings: Story = {};
/** Sorted by P&L, high to low. */
export const SortedByPnl: Story = { args: { initial: { key: 'pnl', dir: 'desc' } } };
/** Nothing held yet: the empty state with Search stocks. */
export const Empty: Story = { args: { holdings: [] } };
