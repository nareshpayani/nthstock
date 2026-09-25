import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatIndexLevel, IndexTicker } from './IndexTicker.js';

describe('formatIndexLevel', () => {
  it('formats hundredths with Indian grouping', () => {
    expect(formatIndexLevel(2541860)).toBe('25,418.60');
    expect(formatIndexLevel(8309215)).toBe('83,092.15');
    expect(formatIndexLevel(-5)).toBe('-0.05');
    expect(() => formatIndexLevel(1.5)).toThrow(RangeError);
  });
});

describe('IndexTicker', () => {
  it('shows up with ▲ and text, and one spoken phrase', () => {
    const { container } = render(
      <IndexTicker name="NIFTY 50" level={2541860} change={21245} changeBasisPoints={84} />,
    );
    expect(container).toHaveTextContent('+212.45 (▲ 0.84%)');
    expect(screen.getByText('NIFTY 50 25,418.60, up 212.45 points, up 0.84 percent')).toHaveClass(
      'sr-only',
    );
    expect(container.firstChild).toHaveAttribute('data-direction', 'up');
  });

  it('shows down with ▼ and flat with ●', () => {
    const { container, rerender } = render(
      <IndexTicker name="SENSEX" level={8309215} change={-9970} changeBasisPoints={-12} />,
    );
    expect(container).toHaveTextContent('-99.70 (▼ 0.12%)');
    expect(container.querySelector('.text-down')).not.toBeNull();
    rerender(<IndexTicker name="SENSEX" level={8309215} change={0} changeBasisPoints={0} />);
    expect(container).toHaveTextContent('0.00 (● 0.00%)');
    expect(screen.getByText(/SENSEX 83,092.15, unchanged, unchanged/)).toBeInTheDocument();
  });
});

describe('IndexTicker compact', () => {
  it('shows only the percent but still speaks the points', () => {
    const { container } = render(
      <IndexTicker name="NIFTY 50" level={2541860} change={21245} changeBasisPoints={84} compact />,
    );
    expect(container).toHaveTextContent('▲ 0.84%');
    expect(container).not.toHaveTextContent('+212.45');
    expect(screen.getByText(/up 212.45 points/)).toBeInTheDocument();
  });
});
