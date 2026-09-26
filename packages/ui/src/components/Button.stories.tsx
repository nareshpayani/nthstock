import type { Meta, StoryObj } from '@storybook/react-vite';
import { IconPlus, IconRefresh } from '../icons/icons.js';
import { Button } from './Button.js';
import { IconButton } from './IconButton.js';

const meta = {
  title: 'Actions/Button',
  component: Button,
  args: { children: 'Place order' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: 'primary' } };
export const Buy: Story = { args: { variant: 'buy', children: 'Buy INFY' } };
export const Sell: Story = { args: { variant: 'sell', children: 'Sell INFY' } };
export const Secondary: Story = { args: { variant: 'secondary', children: 'Cancel' } };
export const Ghost: Story = { args: { variant: 'ghost', children: 'View all' } };
export const WithIcon: Story = { args: { icon: <IconPlus />, children: 'Add stock' } };
export const Loading: Story = { args: { loading: true, children: 'Placing order' } };
export const Disabled: Story = { args: { disabled: true } };

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <Button {...args} size="sm">
        Small
      </Button>
      <Button {...args} size="md">
        Medium
      </Button>
      <Button {...args} size="lg">
        Large
      </Button>
    </div>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary">Primary</Button>
      <Button variant="buy">Buy</Button>
      <Button variant="sell">Sell</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
    </div>
  ),
};

export const IconButtons: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <IconButton label="Add stock" icon={<IconPlus />} />
      <IconButton label="Refresh" icon={<IconRefresh />} variant="secondary" />
      <IconButton label="Add stock" icon={<IconPlus />} variant="primary" />
      <IconButton label="Refreshing" icon={<IconRefresh />} loading />
      <IconButton label="Refresh" icon={<IconRefresh />} disabled size="sm" />
    </div>
  ),
};
