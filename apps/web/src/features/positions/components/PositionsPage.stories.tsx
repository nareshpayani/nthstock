import type { Position } from '@nthstock/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { StoryApiProviders } from '@/mocks/storyApi';
import { PositionsPage } from './PositionsPage';

/** Made-up paper positions only. */
const base: Position = {
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  product: 'INTRADAY',
  netQty: 10,
  buyQty: 10,
  sellQty: 0,
  avgBuyPrice: 1_500_05,
  avgSellPrice: 0,
  ltp: 1_512_35,
  realisedPnl: 0,
  unrealisedPnl: 10 * (1_512_35 - 1_500_05),
};

const POSITIONS: Position[] = [
  base,
  {
    ...base,
    token: 2953217,
    symbol: 'TCS',
    product: 'DELIVERY',
    netQty: 4,
    buyQty: 4,
    avgBuyPrice: 3_820_00,
    ltp: 3_795_40,
    unrealisedPnl: 4 * (3_795_40 - 3_820_00),
  },
  {
    ...base,
    token: 969473,
    symbol: 'WIPRO',
    netQty: -25,
    buyQty: 0,
    sellQty: 25,
    avgBuyPrice: 0,
    avgSellPrice: 295_00,
    ltp: 293_10,
    unrealisedPnl: 25 * (295_00 - 293_10),
  },
  {
    ...base,
    token: 341249,
    symbol: 'HDFCBANK',
    netQty: 0,
    buyQty: 5,
    sellQty: 5,
    avgBuyPrice: 1_720_00,
    avgSellPrice: 1_731_50,
    ltp: 1_729_00,
    realisedPnl: 5 * 11_50,
    unrealisedPnl: 0,
  },
];

function Demo({ positions }: { positions: Position[] }) {
  return (
    <StoryApiProviders routes={{ '/v1/positions': { items: positions } }}>
      <PositionsPage />
    </StoryApiProviders>
  );
}

const meta = {
  title: 'Positions/PositionsPage',
  component: Demo,
  args: { positions: POSITIONS },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Long, short and closed positions with P&L (▲▼ and words) and the pinned total bar. */
export const WithPositions: Story = {};
/** No positions today: the empty state with Search stocks. */
export const Empty: Story = { args: { positions: [] } };
