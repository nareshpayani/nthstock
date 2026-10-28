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

  it('compares from the right when the value gains a digit', () => {
    const { container, rerender } = render(<DigitRoll value="₹999.50" />);
    rerender(<DigitRoll value="₹1,000.50" />);
    expect(container.textContent).toBe('₹1,000.50');
    expect(rolled(container)).toBe('1000');
  });
});
