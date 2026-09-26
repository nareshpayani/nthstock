import type { Instrument } from '@nthstock/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useQuery } from '@tanstack/react-query';
import { StoryProviders } from '@/mocks/storyMarket';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { instrumentQuery, quoteSnapshotQuery } from '../api/stockDetailQueries';
import { StockHeader } from './StockHeader';

function Loaded({ symbol }: { symbol: string }) {
  const api = useApiClient();
  const instrument = useQuery(instrumentQuery(api, { symbol }));
  return instrument.data ? <Header instrument={instrument.data} /> : null;
}

function Header({ instrument }: { instrument: Instrument }) {
  const api = useApiClient();
  const listing = { symbol: instrument.symbol, exchange: instrument.exchange };
  const snapshot = useQuery(quoteSnapshotQuery(api, listing));
  return (
    <StockHeader instrument={instrument} snapshot={snapshot.data} onExchangeChange={() => {}} />
  );
}

function Demo({ symbol }: { symbol: string }) {
  return (
    <StoryProviders>
      <div className="max-w-[1200px]">
        <Loaded symbol={symbol} />
      </div>
    </StoryProviders>
  );
}

const meta = {
  title: 'Stock detail/StockHeader',
  component: Demo,
  args: { symbol: 'INFY' },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An equity: exchange toggle (BSE not listed in the mock), live price, day change, Buy and Sell. */
export const Equity: Story = {};
/** An index: no Buy or Sell. */
export const Index: Story = { args: { symbol: 'NIFTY50' } };
