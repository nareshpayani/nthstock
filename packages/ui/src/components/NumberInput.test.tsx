import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOLD_DELAY_MS, NumberInput, holdRepeat } from './NumberInput.js';

function Quantity({ max }: { max?: number }) {
  const [value, setValue] = useState<number | null>(1);
  return (
    <NumberInput
      mode="integer"
      value={value}
      onChange={setValue}
      aria-label="Quantity"
      {...(max ? { max } : {})}
    />
  );
}

describe('NumberInput hold to repeat (A15)', () => {
  afterEach(() => vi.useRealTimers());

  it('a press steps once; the click after it does not step again', () => {
    render(<Quantity />);
    const plus = screen.getByRole('button', { name: 'Increase quantity' });
    fireEvent.pointerDown(plus, { button: 0 });
    fireEvent.pointerUp(plus);
    fireEvent.click(plus, { detail: 1 });
    expect(screen.getByRole('textbox', { name: 'Quantity' })).toHaveValue('2');
  });

  it('holding keeps stepping, faster and in bigger steps, and stops at the limit or on release', () => {
    vi.useFakeTimers();
    render(<Quantity max={500} />);
    const plus = screen.getByRole('button', { name: 'Increase quantity' });
    const input = screen.getByRole('textbox', { name: 'Quantity' });
    fireEvent.pointerDown(plus, { button: 0 });
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS - 1));
    expect(input).toHaveValue('2');
    act(() => vi.advanceTimersByTime(1000));
    const held = Number((input as HTMLInputElement).value);
    expect(held).toBeGreaterThan(10);
    fireEvent.pointerUp(plus);
    act(() => vi.advanceTimersByTime(1000));
    expect(input).toHaveValue(String(held));
    fireEvent.pointerDown(plus, { button: 0 });
    act(() => vi.advanceTimersByTime(10_000));
    expect(input).toHaveValue('500');
  });

  it('speeds up to a floor; quantities grow their step, prices keep one tick', () => {
    expect(holdRepeat(0, 'integer').waitMs).toBeGreaterThan(holdRepeat(5, 'integer').waitMs);
    expect(holdRepeat(100, 'integer').waitMs).toBe(40);
    expect(holdRepeat(0, 'integer').times).toBe(1);
    expect(holdRepeat(15, 'integer').times).toBe(5);
    expect(holdRepeat(30, 'integer').times).toBe(10);
    expect(holdRepeat(30, 'price').times).toBe(1);
  });
});
