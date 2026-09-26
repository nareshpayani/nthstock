import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { LivePrice, type LivePriceTick } from './LivePrice.js';

const meta = {
  title: 'Data/LivePrice',
  component: LivePrice,
  args: { value: 151235, tick: 'flat', seq: 0 },
} satisfies Meta<typeof LivePrice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Flat: Story = {};
export const Up: Story = { args: { value: 151240, tick: 'up', seq: 1 } };
export const Down: Story = { args: { value: 151230, tick: 'down', seq: 1 } };
export const IndexLevel: Story = {
  args: { value: 2541860, tick: 'up', seq: 1, format: 'index', size: 'lg' },
};

/** Simulated ticks: a seeded walk on the 5-paise tick, one step every 700 ms. */
function Ticking() {
  const [state, setState] = useState({
    value: 151235,
    tick: 'flat' as LivePriceTick,
    seq: 0,
    n: 0,
  });
  useEffect(() => {
    const timer = window.setInterval(() => {
      setState((s) => {
        const step = [5, -5, 10, 0, -10, 5, -5, 15][s.n % 8] ?? 0;
        if (step === 0) return { ...s, n: s.n + 1 };
        return {
          value: s.value + step,
          tick: step > 0 ? 'up' : 'down',
          seq: s.seq + 1,
          n: s.n + 1,
        };
      });
    }, 700);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="flex items-center gap-3 rounded-md border border-line bg-surface px-4 py-3">
      <span className="text-label font-semibold text-ink-muted">INFY</span>
      <LivePrice value={state.value} tick={state.tick} seq={state.seq} />
    </div>
  );
}

export const SimulatedTicks: Story = { render: () => <Ticking /> };
