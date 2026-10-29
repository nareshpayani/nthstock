import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from './Button.js';
import { DigitRoll } from './DigitRoll.js';

// DigitRoll (SPEC-CR-1 §5.6): only the digits that changed roll, up or down. With the system's
// reduced-motion setting on, the same buttons swap the digits with no motion.
const meta = {
  title: 'Data/DigitRoll',
  component: DigitRoll,
  args: { value: '₹1,523.85' },
} satisfies Meta<typeof DigitRoll>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Static: Story = {};

const PRICES = ['₹1,523.85', '₹1,523.95', '₹1,524.05', '₹1,519.70', '₹999.50', '₹1,000.50'];

function Ticking() {
  const [index, setIndex] = useState(0);
  const value = PRICES[index % PRICES.length] ?? '';
  return (
    <div className="flex items-center gap-6">
      <span className="font-mono text-display text-ink">
        <DigitRoll value={value} />
      </span>
      <Button variant="secondary" onClick={() => setIndex((current) => current + 1)}>
        Next price
      </Button>
    </div>
  );
}

export const UpAndDown: Story = { render: () => <Ticking /> };
