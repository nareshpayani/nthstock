import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { DigitRoll } from './DigitRoll.js';

const meta = {
  title: 'Data/DigitRoll',
  component: DigitRoll,
  args: { value: '₹1,523.85' },
} satisfies Meta<typeof DigitRoll>;

export default meta;
type Story = StoryObj<typeof meta>;

function Alternating({ values }: { values: [string, string] }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((i) => 1 - i);
    }, 1500);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  return <DigitRoll value={values[index] ?? values[0]} className="text-2xl" />;
}

export const Still: Story = {};
/** Changed digits roll in from below while the value rises. */
export const Up: Story = {
  render: () => <Alternating values={['₹1,523.85', '₹1,528.90']} />,
};
/** Changed digits roll in from above while the value falls. */
export const Down: Story = {
  render: () => <Alternating values={['₹1,528.90', '₹1,523.85']} />,
};
/** With "prefers-reduced-motion" emulated in the browser the digits swap with no roll. */
export const ReducedMotion: Story = {
  render: () => <Alternating values={['₹1,523.85', '₹1,528.90']} />,
};
