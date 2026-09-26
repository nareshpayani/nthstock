import type { CandleRange } from '@nthstock/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { StoryProviders } from '@/mocks/storyMarket';
import { IndexChartCard } from './IndexChartCard';

function Demo({ marketOpen, initialRange }: { marketOpen: boolean; initialRange: CandleRange }) {
  const [range, setRange] = useState<CandleRange>(initialRange);
  return (
    <StoryProviders marketOpen={marketOpen}>
      <div className="max-w-4xl">
        <IndexChartCard range={range} onRangeChange={setRange} />
      </div>
    </StoryProviders>
  );
}

const meta = {
  title: 'Dashboard/IndexChartCard',
  component: Demo,
  args: { marketOpen: true, initialRange: '1Y' },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Mock market data through the real MSW handlers; LIVE while the market is open. */
export const MarketOpen: Story = {};
export const MarketClosed: Story = { args: { marketOpen: false } };
export const Intraday: Story = { args: { initialRange: '1D' } };
