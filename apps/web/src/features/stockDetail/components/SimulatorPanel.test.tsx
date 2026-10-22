import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerSimulator, type SimulatorActions } from '@/shared/lib/demoSimulator';
import { SimulatorPanel } from './SimulatorPanel';

afterEach(() => {
  registerSimulator(null);
});

function fakeSimulator(): SimulatorActions {
  return {
    rally: vi.fn(() => Promise.resolve(true)),
    pullBack: vi.fn(() => Promise.resolve(true)),
    gapDown: vi.fn(() => Promise.resolve(true)),
    setSplitFills: vi.fn(() => Promise.resolve()),
    splitFills: vi.fn(() => false),
  };
}

describe('SimulatorPanel (T09)', () => {
  it('renders nothing outside demo mode', () => {
    const { container } = render(<SimulatorPanel symbol="INFY" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('labels itself Simulated and drives the Simulator for its symbol', async () => {
    const simulator = fakeSimulator();
    registerSimulator(simulator);
    const user = userEvent.setup();
    render(<SimulatorPanel symbol="INFY" />);

    expect(screen.getByText('Simulated')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rally +1%' }));
    await user.click(screen.getByRole('button', { name: 'Pull back −1%' }));
    await user.click(screen.getByRole('button', { name: 'Gap −3%' }));
    expect(simulator.rally).toHaveBeenCalledWith('INFY');
    expect(simulator.pullBack).toHaveBeenCalledWith('INFY');
    expect(simulator.gapDown).toHaveBeenCalledWith('INFY');

    const split = screen.getByRole('button', { name: 'Split large fills' });
    expect(split).toHaveAttribute('aria-pressed', 'false');
    await user.click(split);
    expect(simulator.setSplitFills).toHaveBeenCalledWith('INFY', true);
    expect(split).toHaveAttribute('aria-pressed', 'true');
  });
});
