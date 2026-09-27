import type { Meta, StoryObj } from '@storybook/react-vite';
import { useQuery } from '@tanstack/react-query';
import { StoryProviders } from '@/mocks/storyMarket';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { instrumentQuery } from '../api/stockDetailQueries';
import { MarketDepthCard } from './MarketDepthCard';

function Loaded({ symbol }: { symbol: string }) {
  const api = useApiClient();
  const instrument = useQuery(instrumentQuery(api, { symbol }));
  return instrument.data ? <MarketDepthCard instrument={instrument.data} /> : null;
}

type DemoProps = { symbol: string; marketOpen: boolean; width: number };

function Demo({ symbol, marketOpen, width }: DemoProps) {
  return (
    <StoryProviders marketOpen={marketOpen}>
      <div style={{ maxWidth: width }}>
        <Loaded symbol={symbol} />
      </div>
    </StoryProviders>
  );
}

const meta = {
  title: 'Stock detail/MarketDepthCard',
  component: Demo,
  args: { symbol: 'INFY', marketOpen: false, width: 352 },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The right-column width from 1024 px: bids above offers, bars scaled to the largest level. */
export const Column: Story = {};
/** Full width under 1024 px: bids and offers side by side. */
export const Wide: Story = { args: { width: 720 } };
/** Market open: refreshes every second while on screen and the tab is visible. */
export const MarketOpen: Story = { args: { marketOpen: true } };
