import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { StoryProviders } from '@/mocks/storyMarket';
import { StocksListsCard } from './StocksListsCard';

function Demo({ initialList }: { initialList: string }) {
  const [listId, setListId] = useState(initialList);
  return (
    <StoryProviders>
      <div className="max-w-xl">
        <StocksListsCard listId={listId} onListChange={setListId} />
      </div>
    </StoryProviders>
  );
}

const meta = {
  title: 'Dashboard/StocksListsCard',
  component: Demo,
  args: { initialList: 'market-giants' },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Curated lists from the mock market, through the real MSW handlers. */
export const MarketGiants: Story = {};
export const TopIt: Story = { args: { initialList: 'top-it' } };
