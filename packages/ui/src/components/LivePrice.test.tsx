import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LivePrice } from './LivePrice.js';

describe('LivePrice', () => {
  it('formats paise as rupees and index levels as points', () => {
    const { rerender } = render(<LivePrice value={151235} tick="flat" seq={0} />);
    expect(screen.getByText('₹1,512.35')).toBeInTheDocument();
    rerender(<LivePrice value={2541860} tick="flat" seq={0} format="index" />);
    expect(screen.getByText('25,418.60')).toBeInTheDocument();
  });

  it('shows ▲ and a green flash on an up tick, alternating the animation on each change', () => {
    const { container, rerender } = render(<LivePrice value={151240} tick="up" seq={1} />);
    const root = container.firstElementChild;
    expect(root).toHaveAttribute('data-tick', 'up');
    expect(root).toHaveClass('animate-flash-up-b', 'motion-reduce:animate-none');
    expect(screen.getByText('▲')).toHaveClass('text-up');
    expect(screen.getByText('▲')).toHaveAttribute('aria-hidden', 'true');
    rerender(<LivePrice value={151245} tick="up" seq={2} />);
    expect(root).toHaveClass('animate-flash-up-a');
    expect(root).not.toHaveClass('animate-flash-up-b');
  });

  it('shows ▼ and a red flash on a down tick', () => {
    const { container } = render(<LivePrice value={151230} tick="down" seq={3} size="lg" />);
    expect(container.firstElementChild).toHaveClass('animate-flash-down-b', 'text-title');
    expect(screen.getByText('▼')).toHaveClass('text-down');
  });

  it('does not flash before the first change, and keeps the marker space reserved', () => {
    const { container } = render(<LivePrice value={151235} tick="flat" seq={0} size="sm" />);
    expect(container.firstElementChild?.className).not.toMatch(/animate-flash/);
    expect(screen.getByText('▲')).toHaveClass('invisible');
  });
});
