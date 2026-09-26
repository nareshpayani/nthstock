import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl.js';
import { Switch } from './Switch.js';

type Side = 'BUY' | 'SELL';

function SideControl({ onChange }: { onChange?: (side: Side) => void }) {
  const [side, setSide] = useState<Side>('BUY');
  return (
    <SegmentedControl
      label="Order side"
      options={[
        { value: 'BUY', label: 'Buy', tone: 'up' },
        { value: 'SELL', label: 'Sell', tone: 'down' },
      ]}
      value={side}
      onValueChange={(next) => {
        setSide(next);
        onChange?.(next);
      }}
    />
  );
}

describe('SegmentedControl', () => {
  it('is a radiogroup of radios', () => {
    render(<SideControl />);
    expect(screen.getByRole('radiogroup', { name: 'Order side' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByRole('radio', { name: 'Buy' })).toHaveAttribute('aria-checked', 'true');
  });

  it('arrow keys move the selection', async () => {
    const onChange = vi.fn();
    render(<SideControl onChange={onChange} />);
    const buy = screen.getByRole('radio', { name: 'Buy' });
    buy.focus();
    fireEvent.keyDown(buy, { key: 'ArrowRight' });
    const sell = screen.getByRole('radio', { name: 'Sell' });
    await waitFor(() => expect(sell).toHaveFocus());
    expect(sell).toHaveAttribute('aria-checked', 'true');
    expect(onChange).toHaveBeenLastCalledWith('SELL');
    fireEvent.keyDown(sell, { key: 'ArrowLeft' });
    await waitFor(() => expect(buy).toHaveAttribute('aria-checked', 'true'));
  });

  it('selects on click', () => {
    render(<SideControl />);
    fireEvent.click(screen.getByRole('radio', { name: 'Sell' }));
    expect(screen.getByRole('radio', { name: 'Sell' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Switch', () => {
  it('toggles and is labelled', () => {
    const onCheckedChange = vi.fn();
    render(<Switch label="Show P&L in percent" onCheckedChange={onCheckedChange} />);
    const control = screen.getByRole('switch', { name: 'Show P&L in percent' });
    expect(control).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(control).toHaveAttribute('aria-checked', 'true');
  });
});
