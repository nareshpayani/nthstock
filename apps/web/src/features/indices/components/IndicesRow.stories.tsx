import type { Meta, StoryObj } from '@storybook/react-vite';
import { StoryProviders } from '@/mocks/storyMarket';
import { IndicesRow } from './IndicesRow';

function Demo() {
  return (
    <StoryProviders>
      <div className="max-w-5xl">
        <IndicesRow />
      </div>
    </StoryProviders>
  );
}

const meta = { title: 'Dashboard/IndicesRow', component: Demo } satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every index from the mock market, through the real MSW handlers. Focus the row and use ←/→. */
export const Default: Story = {};

/** Narrow screens scroll and snap card by card. */
export const Phone: Story = {
  decorators: [
    (Story) => (
      <div className="w-[358px]">
        <Story />
      </div>
    ),
  ],
};
