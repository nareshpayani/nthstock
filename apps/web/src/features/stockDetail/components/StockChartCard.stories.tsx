import type { CandleRange, Instrument } from '@nthstock/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StoryProviders } from '@/mocks/storyMarket';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { instrumentQuery } from '../api/stockDetailQueries';
import type { ChartType } from '../model/stockDetailSearch';
import { StockChartCard } from './StockChartCard';

function Chart({ instrument, initialType }: { instrument: Instrument; initialType: ChartType }) {
  const [range, setRange] = useState<CandleRange>('1D');
  const [chartType, setChartType] = useState(initialType);
  return (
    <StockChartCard
      instrument={instrument}
      range={range}
      chartType={chartType}
      onRangeChange={setRange}
      onChartTypeChange={setChartType}
    />
  );
}

function Loaded({ initialType }: { initialType: ChartType }) {
  const api = useApiClient();
  const instrument = useQuery(instrumentQuery(api, { symbol: 'INFY' }));
  return instrument.data ? <Chart instrument={instrument.data} initialType={initialType} /> : null;
}

function Demo({ initialType }: { initialType: ChartType }) {
  return (
    <StoryProviders>
      <div className="max-w-3xl">
        <Loaded initialType={initialType} />
      </div>
    </StoryProviders>
  );
}

const meta = {
  title: 'Stock detail/StockChartCard',
  component: Demo,
  args: { initialType: 'area' },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** INFY from the mock market: range tabs, area/candle toggle and the crosshair tooltip. */
export const Area: Story = {};
export const Candles: Story = { args: { initialType: 'candle' } };
