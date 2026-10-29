import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PulseDot } from './PulseDot.js';

describe('PulseDot (NSTOCK-0462)', () => {
  it('draws a dot with a ripple ring that reduced motion hides, out of the accessibility tree', () => {
    const { container } = render(<PulseDot tone="down" />);
    const root = container.firstElementChild;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    const ripple = container.querySelector('[data-part="ripple"]');
    expect(ripple).toHaveClass('animate-ripple', 'motion-reduce:hidden', 'bg-down');
  });

  it('defaults to the brand tone', () => {
    const { container } = render(<PulseDot />);
    const ripple = container.querySelector('[data-part="ripple"]');
    expect(ripple).toHaveClass('bg-brand');
    expect(ripple).not.toHaveClass('bg-down');
  });
});
