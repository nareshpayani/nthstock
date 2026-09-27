import type { OrderSide } from '@nthstock/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { StoryProviders } from '@/mocks/storyMarket';
import { OrderTicket } from './OrderTicket';

type DemoProps = { symbol: string; side: OrderSide; marketOpen: boolean };

/**
 * The ticket body as it shows inside the slide-over (the sheet itself is in Overlays), on the
 * in-process mock market. The story market has no funds endpoint, so available cash reads "—".
 */
function Demo({ symbol, side, marketOpen }: DemoProps) {
  return (
    <StoryProviders marketOpen={marketOpen}>
      <div className="w-[440px] max-w-full border border-line bg-surface">
        <OrderTicket intent={{ symbol, exchange: 'NSE', side }} onClose={() => undefined} />
      </div>
    </StoryProviders>
  );
}

const meta = {
  title: 'Order ticket/OrderTicket',
  component: Demo,
  args: { symbol: 'INFY', side: 'BUY', marketOpen: true },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Market open: Buy INFY at market, price prefilled with the LTP and disabled. */
export const Buy: Story = {};
/** Sell side: red Sell segment and button, labelled in text too. */
export const Sell: Story = { args: { side: 'SELL' } };
/** Market closed (the story clock is a Saturday): the AMO banner and Place AMO. */
export const MarketClosedAmo: Story = { args: { marketOpen: false } };
