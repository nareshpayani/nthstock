import type { Meta, StoryObj } from '@storybook/react-vite';
import { makeCandles } from '@/test/candles';
import { PriceChart } from './PriceChart';

const meta = {
  title: 'Charts/PriceChart',
  component: PriceChart,
  args: {
    label: 'INFY area chart over 1 day',
    candles: makeCandles({ count: 75, stepMs: 5 * 60_000, first: 151_000, step: 40 }),
    format: 'inr',
    intraday: true,
    height: 280,
  },
  decorators: [
    (Story) => (
      <div className="max-w-3xl rounded-lg border border-line bg-surface p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PriceChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const IntradayArea: Story = {};

export const YearFalling: Story = {
  args: {
    label: 'NIFTY 50 area chart over 1 year',
    candles: makeCandles({
      count: 250,
      start: '2025-09-25T03:45:00.000Z',
      stepMs: 86_400_000,
      first: 2_700_000,
      step: -900,
    }),
    format: 'index',
    intraday: false,
  },
};

export const Candles: Story = {
  args: {
    label: 'INFY candlestick chart over 1 month',
    type: 'candle',
    candles: makeCandles({
      count: 22,
      start: '2026-08-25T03:45:00.000Z',
      stepMs: 86_400_000,
      first: 150_000,
      step: 350,
    }),
    intraday: false,
  },
};

export const Empty: Story = { args: { candles: [], label: 'INFY chart, no data' } };
