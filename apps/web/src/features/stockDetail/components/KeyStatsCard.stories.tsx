import type { Meta, StoryObj } from '@storybook/react-vite';
import { useQuery } from '@tanstack/react-query';
import { StoryProviders } from '@/mocks/storyMarket';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { instrumentQuery } from '../api/stockDetailQueries';
import { KeyStatsCard } from './KeyStatsCard';

function Loaded({ symbol }: { symbol: string }) {
  const api = useApiClient();
  const instrument = useQuery(instrumentQuery(api, { symbol }));
  return instrument.data ? <KeyStatsCard instrument={instrument.data} /> : null;
}

function Demo({ symbol }: { symbol: string }) {
  return (
    <StoryProviders>
      <div className="max-w-sm">
        <Loaded symbol={symbol} />
      </div>
    </StoryProviders>
  );
}

const meta = {
  title: 'Stock detail/KeyStatsCard',
  component: Demo,
  args: { symbol: 'TCS' },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Stats from the mock market: day and 52-week range bars, market cap in crore, P/E, yield. */
export const LargeCap: Story = {};
export const Infosys: Story = { args: { symbol: 'INFY' } };
