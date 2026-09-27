import type { Meta, StoryObj } from '@storybook/react-vite';
import { useQuery } from '@tanstack/react-query';
import { StoryProviders } from '@/mocks/storyMarket';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { instrumentQuery } from '../api/stockDetailQueries';
import { OverviewCard } from './OverviewCard';

function Loaded({ symbol }: { symbol: string }) {
  const api = useApiClient();
  const instrument = useQuery(instrumentQuery(api, { symbol }));
  return instrument.data ? <OverviewCard instrument={instrument.data} /> : null;
}

function Demo({ symbol }: { symbol: string }) {
  return (
    <StoryProviders>
      <div className="max-w-2xl">
        <Loaded symbol={symbol} />
      </div>
    </StoryProviders>
  );
}

const meta = {
  title: 'Stock detail/OverviewCard',
  component: Demo,
  args: { symbol: 'INFY' },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Sector, size and index chips, with the about text collapsed behind Read more. */
export const Infosys: Story = {};
export const Bank: Story = { args: { symbol: 'HDFCBANK' } };
