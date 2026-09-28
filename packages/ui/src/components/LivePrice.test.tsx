import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LivePrice } from './LivePrice.js';

describe('LivePrice', () => {
  it('formats paise as rupees and index levels as points', () => {
    const { rerender } = render(<LivePrice value={151235} tick="flat" />);
    expect(screen.getByText('₹1,512.35')).toBeInTheDocument();
    rerender(<LivePrice value={2541860} tick="flat" format="index" />);
    expect(screen.getByText('25,418.60')).toBeInTheDocument();
  });

  it('shows a green ▲ on an up tick and a red ▼ on a down tick, with no background flash', () => {
    const { container, rerender } = render(<LivePrice value={151240} tick="up" />);
    const root = container.firstElementChild;
    expect(root).toHaveAttribute('data-tick', 'up');
    expect(root?.className).not.toMatch(/animate-/);
    expect(screen.getByText('▲')).toHaveClass('text-up');
    expect(screen.getByText('▲')).toHaveAttribute('aria-hidden', 'true');
    rerender(<LivePrice value={151230} tick="down" size="lg" />);
    expect(root).toHaveClass('text-title');
    expect(root?.className).not.toMatch(/animate-/);
    expect(screen.getByText('▼')).toHaveClass('text-down');
  });

  it('keeps the marker space reserved before the first change', () => {
    render(<LivePrice value={151235} tick="flat" size="sm" />);
    expect(screen.getByText('▲')).toHaveClass('invisible');
  });
});
