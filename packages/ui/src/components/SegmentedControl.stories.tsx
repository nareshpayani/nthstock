import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { SegmentedControl } from './SegmentedControl.js';
import { Switch } from './Switch.js';

const meta = {
  title: 'Forms/SegmentedControl',
  component: SegmentedControl,
  args: { label: 'Order side', options: [], value: '', onValueChange: () => undefined },
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

function OrderControls() {
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [type, setType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [product, setProduct] = useState<'DELIVERY' | 'INTRADAY'>('DELIVERY');
  return (
    <div className="grid max-w-xs gap-3">
      <SegmentedControl
        label="Order side"
        value={side}
        onValueChange={setSide}
        options={[
          { value: 'BUY', label: 'Buy', tone: 'up' },
          { value: 'SELL', label: 'Sell', tone: 'down' },
        ]}
      />
      <SegmentedControl
        label="Order type"
        value={type}
        onValueChange={setType}
        options={[
          { value: 'MARKET', label: 'Market' },
          { value: 'LIMIT', label: 'Limit' },
        ]}
      />
      <SegmentedControl
        label="Product"
        size="sm"
        value={product}
        onValueChange={setProduct}
        options={[
          { value: 'DELIVERY', label: 'Delivery' },
          { value: 'INTRADAY', label: 'Intraday' },
        ]}
      />
    </div>
  );
}

export const OrderTicketControls: Story = { render: () => <OrderControls /> };

export const Disabled: Story = {
  render: () => (
    <SegmentedControl
      label="Order type"
      value="MARKET"
      onValueChange={() => undefined}
      disabled
      options={[
        { value: 'MARKET', label: 'Market' },
        { value: 'LIMIT', label: 'Limit' },
      ]}
    />
  ),
};

export const SwitchStory: Story = {
  name: 'Switch',
  render: () => (
    <div className="grid gap-3">
      <Switch label="Show P&L in percent" defaultChecked />
      <Switch label="Confirm before placing orders" />
    </div>
  ),
};
