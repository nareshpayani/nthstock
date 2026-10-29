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

  it('shows the price and ▲ in green on an up day, with no background flash', () => {
    const { container, rerender } = render(<LivePrice value={151240} tick="up" />);
    const root = container.firstElementChild;
    expect(root).toHaveAttribute('data-tick', 'up');
    expect(root?.className).not.toMatch(/animate-|bg-/);
    expect(root).toHaveClass('text-up');
    expect(screen.getByText('▲')).toHaveAttribute('aria-hidden', 'true');
    rerender(<LivePrice value={151245} tick="up" />);
    expect(screen.getByText('₹1,512.45')).toBeInTheDocument();
    expect(root?.className).not.toMatch(/animate-|bg-/);
  });

  it('shows the price and ▼ in red on a down day', () => {
    const { container } = render(<LivePrice value={151230} tick="down" size="lg" />);
    expect(container.firstElementChild).toHaveClass('text-title');
    expect(container.firstElementChild?.className).not.toMatch(/animate-/);
    expect(container.firstElementChild).toHaveClass('text-down');
    expect(screen.getByText('▼')).toBeInTheDocument();
  });

  it('keeps the marker space reserved before the first change', () => {
    render(<LivePrice value={151235} tick="flat" size="sm" />);
    expect(screen.getByText('▲')).toHaveClass('invisible');
    expect(screen.getByText('₹1,512.35').closest('[data-tick]')).toHaveClass('text-ink');
  });
});
