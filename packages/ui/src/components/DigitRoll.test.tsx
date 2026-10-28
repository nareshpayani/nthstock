import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DigitRoll } from './DigitRoll.js';

const rolled = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-rolled]')].map((span) => span.textContent).join('');

describe('DigitRoll', () => {
  it('reads as the whole value', () => {
    const { container } = render(<DigitRoll value="₹1,523.85" />);
    expect(container.textContent).toBe('₹1,523.85');
    expect(rolled(container)).toBe('');
  });

  it('rolls only the digits that changed, upwards when the value rose', () => {
    const { container, rerender } = render(<DigitRoll value="₹1,523.85" />);
    rerender(<DigitRoll value="₹1,523.95" />);
    expect(container.textContent).toBe('₹1,523.95');
    expect(rolled(container)).toBe('9');
    expect(container.querySelector('[data-rolled]')?.className).toBe('nth-digit-up');
  });

  it('rolls downwards when the value fell', () => {
    const { container, rerender } = render(<DigitRoll value="₹1,523.85" />);
    rerender(<DigitRoll value="₹1,519.85" />);
    expect(rolled(container)).toBe('19');
    expect(container.querySelector('[data-rolled]')?.className).toBe('nth-digit-down');
  });

  it('treats a Unicode minus as negative when picking the direction', () => {
    const { container, rerender } = render(<DigitRoll value="−1.50" />);
    rerender(<DigitRoll value="−2.50" />);
    expect(container.querySelector('[data-rolled]')?.className).toBe('nth-digit-down');
  });

  it('swaps without a direction when a side has no number', () => {
    const { container, rerender } = render(<DigitRoll value="—" />);
    rerender(<DigitRoll value="₹10.00" />);
    expect(container.textContent).toBe('₹10.00');
    expect(container.querySelector('.nth-digit-up, .nth-digit-down')).toBeNull();
  });

  it('compares from the right when the value gains a digit', () => {
    const { container, rerender } = render(<DigitRoll value="₹999.50" />);
    rerender(<DigitRoll value="₹1,000.50" />);
    expect(container.textContent).toBe('₹1,000.50');
    expect(rolled(container)).toBe('1000');
  });

  it('swaps without a roll from a placeholder, and handles a Unicode minus', () => {
    const { container, rerender } = render(<DigitRoll value="—" />);
    rerender(<DigitRoll value="₹1,523.85" />);
    expect(rolled(container)).toBe('');
    rerender(<DigitRoll value="−₹4.20" />);
    rerender(<DigitRoll value="−₹4.10" />);
    // −4.10 is above −4.20: the minus is read, so the roll goes up.
    expect(container.querySelector('[data-rolled]')?.className).toBe('nth-digit-up');
  });

  it('keeps still on a same-value render and rolls again on the next change', () => {
    const { container, rerender } = render(<DigitRoll value="₹10.00" />);
    rerender(<DigitRoll value="₹10.00" />);
    expect(rolled(container)).toBe('');
    rerender(<DigitRoll value="₹10.05" />);
    rerender(<DigitRoll value="₹10.15" />);
    expect(rolled(container)).toBe('1');
  });
});
