import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button.js';
import { ChangeBadge } from './ChangeBadge.js';
import { Skeleton } from './Skeleton.js';
import { Sparkline } from './Sparkline.js';
import { EmptyState, ErrorState } from './States.js';
import { IconPlus } from '../icons/icons.js';

const meta = {
  title: 'Data/ChangeBadge',
  component: ChangeBadge,
  args: { basisPoints: 125 },
} satisfies Meta<typeof ChangeBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Up: Story = {};
export const Down: Story = { args: { basisPoints: -48 } };
export const Flat: Story = { args: { basisPoints: 0 } };
export const WithAbsolute: Story = { args: { basisPoints: 84, absolute: '+212.45', soft: true } };
export const Soft: Story = {
  render: () => (
    <div className="flex gap-2">
      <ChangeBadge basisPoints={207} soft size="sm" />
      <ChangeBadge basisPoints={-112} soft size="sm" />
      <ChangeBadge basisPoints={0} soft size="sm" />
    </div>
  ),
};

const rising = Array.from({ length: 100 }, (_, i) => 1000 + i * 2 + ((i * 37) % 23));
const falling = rising.map((v) => 1400 - v);

export const Sparklines: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <Sparkline points={rising} label="Sample series, up" />
      <Sparkline points={falling} label="Sample series, down" />
      <Sparkline points={[5, 5, 5, 5]} label="Sample series, unchanged" />
      <Sparkline points={rising} label="Wide sample series, up" width={240} height={64} />
    </div>
  ),
};

export const Skeletons: Story = {
  render: () => (
    <div className="grid max-w-sm gap-3 rounded-lg border border-line bg-surface p-4">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-24 w-full" />
    </div>
  ),
};

export const Empty: Story = {
  render: () => (
    <div className="max-w-sm rounded-lg border border-line bg-surface">
      <EmptyState
        title="Your watchlist is empty"
        description="Add stocks to track their prices here."
        action={<Button icon={<IconPlus size={16} />}>Add stock</Button>}
      />
    </div>
  ),
};

export const ErrorStory: Story = {
  name: 'Error',
  render: () => (
    <div className="max-w-sm rounded-lg border border-line bg-surface">
      <ErrorState description="We couldn't load market movers." onRetry={() => undefined} />
    </div>
  ),
};
