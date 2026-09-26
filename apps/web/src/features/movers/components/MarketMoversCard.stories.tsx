import type { MoverDirection } from '@nthstock/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { StoryProviders } from '@/mocks/storyMarket';
import { MarketMoversCard } from './MarketMoversCard';

function Demo({ initialDirection }: { initialDirection: MoverDirection }) {
  const [index, setIndex] = useState<string | undefined>(undefined);
  const [direction, setDirection] = useState(initialDirection);
  return (
    <StoryProviders>
      <div className="max-w-xl">
        <MarketMoversCard
          index={index}
          direction={direction}
          onIndexChange={setIndex}
          onDirectionChange={setDirection}
        />
      </div>
    </StoryProviders>
  );
}

const meta = {
  title: 'Dashboard/MarketMoversCard',
  component: Demo,
  args: { initialDirection: 'gainers' },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Movers from the mock market, through the real MSW handlers. */
export const Gainers: Story = {};
export const Losers: Story = { args: { initialDirection: 'losers' } };
