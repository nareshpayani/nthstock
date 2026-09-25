import type { Meta, StoryObj } from '@storybook/react-vite';
import { IndexTicker } from './IndexTicker.js';

// Sample index values for the stories only (live data arrives in E4).
const meta = {
  title: 'Data/IndexTicker',
  component: IndexTicker,
  args: { name: 'NIFTY 50', level: 2541860, change: 21245, changeBasisPoints: 84 },
} satisfies Meta<typeof IndexTicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Up: Story = {};
export const Down: Story = {
  args: { name: 'SENSEX', level: 8309215, change: -9970, changeBasisPoints: -12 },
};
export const Flat: Story = {
  args: { name: 'NIFTY BANK', level: 5612040, change: 0, changeBasisPoints: 0 },
};
export const InHeader: Story = {
  render: () => (
    <div className="flex gap-6 rounded-md border border-line bg-surface px-4 py-3">
      <IndexTicker name="NIFTY 50" level={2541860} change={21245} changeBasisPoints={84} />
      <IndexTicker name="SENSEX" level={8309215} change={-9970} changeBasisPoints={-12} />
    </div>
  ),
};
