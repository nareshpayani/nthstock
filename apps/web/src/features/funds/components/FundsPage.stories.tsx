import {
  PAPER_OPENING_BALANCE_PAISE,
  type FundsSummary,
  type LedgerEntry,
  type Position,
} from '@nthstock/contracts';
import { Button } from '@nthstock/ui';
import { fromIst } from '@nthstock/utils';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { StoryApiProviders } from '@/mocks/storyApi';
import { FundsPage } from './FundsPage';
import { ResetFundsDialog } from './ResetFundsDialog';

/** Made-up paper funds only: one ₹15,000 buy and a resting limit order. */
const at = (minute: number) => fromIst(2026, 9, 28, minute).toISOString();
const FUNDS: FundsSummary = {
  openingBalance: PAPER_OPENING_BALANCE_PAISE,
  balance: PAPER_OPENING_BALANCE_PAISE - 15_000_00,
  blocked: 2_800_00,
  available: PAPER_OPENING_BALANCE_PAISE - 15_000_00 - 2_800_00,
  realisedPnlToday: 0,
  asOf: at(11 * 60),
};
const POSITION: Position = {
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  product: 'DELIVERY',
  netQty: 10,
  buyQty: 10,
  sellQty: 0,
  avgBuyPrice: 1_500_00,
  avgSellPrice: 0,
  ltp: 1_512_35,
  realisedPnl: 0,
  unrealisedPnl: 10 * 12_35,
};
const entry = (
  id: string,
  type: LedgerEntry['type'],
  amount: number,
  balanceAfter: number,
  minute: number,
  description: string,
): LedgerEntry => ({
  id,
  type,
  amount,
  balanceAfter,
  orderId: type === 'OPENING_CREDIT' ? null : 'pe_story1',
  description,
  createdAt: at(minute),
});
const OPEN = PAPER_OPENING_BALANCE_PAISE;
const LEDGER: LedgerEntry[] = [
  entry(
    'le5',
    'ORDER_BLOCK',
    -2_800_00,
    OPEN - 17_800_00,
    10 * 60 + 9,
    'Blocked for order pe_story2',
  ),
  entry(
    'le4',
    'TRADE_DEBIT',
    -15_000_00,
    OPEN - 15_000_00,
    10 * 60 + 2,
    'Bought under order pe_story1',
  ),
  entry('le3', 'ORDER_RELEASE', 15_000_00, OPEN, 10 * 60 + 2, 'Released from order pe_story1'),
  entry(
    'le2',
    'ORDER_BLOCK',
    -15_000_00,
    OPEN - 15_000_00,
    10 * 60 + 2,
    'Blocked for order pe_story1',
  ),
  entry('le1', 'OPENING_CREDIT', OPEN, OPEN, 9 * 60, 'Opening paper balance'),
];

function Demo() {
  return (
    <StoryApiProviders
      routes={{
        '/v1/funds': FUNDS,
        '/v1/funds/ledger': { items: LEDGER, nextCursor: null },
        '/v1/positions': { items: [POSITION] },
        '/v1/holdings': { items: [] },
      }}
    >
      <FundsPage />
    </StoryApiProviders>
  );
}

const meta = {
  title: 'Funds/FundsPage',
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The summary over the virtualised ledger, with Reset paper balance in the header. */
export const Default: Story = {};

/** The reset danger dialog, open: Reset stays disabled until RESET is typed. */
export const ResetDialog: Story = {
  render: () => (
    <ResetFundsDialog
      trigger={<Button variant="secondary">Reset paper balance</Button>}
      open
      onOpenChange={() => undefined}
      resetting={false}
      onConfirm={() => undefined}
    />
  ),
};
