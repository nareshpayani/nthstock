import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChangeBadge } from './ChangeBadge.js';
import { Skeleton } from './Skeleton.js';
import { Sparkline, sparklinePath } from './Sparkline.js';
import { EmptyState, ErrorState } from './States.js';

describe('ChangeBadge', () => {
  it('renders the arrow, the text and the screen-reader label, not only a colour', () => {
    const { container } = render(<ChangeBadge basisPoints={125} />);
    expect(container).toHaveTextContent('▲ 1.25%');
    expect(screen.getByText('up 1.25 percent')).toHaveClass('sr-only');
    expect(container.firstChild).toHaveClass('text-up');
  });

  it('handles down and flat, with an absolute change and soft tint', () => {
    const { container, rerender } = render(<ChangeBadge basisPoints={-48} absolute="-8.85" soft />);
    expect(container).toHaveTextContent('-8.85 (▼ 0.48%)');
    expect(screen.getByText('-8.85, down 0.48 percent')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('text-down', 'bg-down-soft');
    rerender(<ChangeBadge basisPoints={0} size="sm" />);
    expect(container).toHaveTextContent('● 0.00%');
    expect(screen.getByText('unchanged')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('text-ink-muted');
  });
});

describe('Sparkline', () => {
  it('renders 100 points as a single path with a text alternative', () => {
    const points = Array.from({ length: 100 }, (_, i) => 1000 + i * 3);
    const { container } = render(<Sparkline points={points} label="INFY today, up" />);
    expect(screen.getByRole('img', { name: 'INFY today, up' })).toHaveAttribute(
      'data-direction',
      'up',
    );
    const paths = container.querySelectorAll('path');
    expect(paths).toHaveLength(1);
    expect(paths[0]?.getAttribute('d')?.match(/[ML]/g)).toHaveLength(100);
  });

  it('draws a flat series without dividing by zero', () => {
    const d = sparklinePath([500, 500, 500], 100, 20);
    expect(d).toBe('M1.00 10.00L50.00 10.00L99.00 10.00');
    expect(d).not.toContain('NaN');
    render(<Sparkline points={[5, 5]} label="flat" />);
    expect(screen.getByRole('img', { name: 'flat' })).toHaveAttribute('data-direction', 'flat');
  });

  it('handles empty and single-point series and down direction', () => {
    expect(sparklinePath([], 10, 10)).toBe('');
    expect(sparklinePath([7], 10, 10)).toBe('M1.00 5.00');
    render(<Sparkline points={[9, 3]} label="down" />);
    expect(screen.getByRole('img', { name: 'down' })).toHaveClass('text-down');
    render(<Sparkline points={[]} label="none" direction="up" />);
    expect(screen.getByRole('img', { name: 'none' })).toHaveClass('text-up');
  });
});

describe('Skeleton, EmptyState, ErrorState', () => {
  it('skeleton is hidden from assistive tech', () => {
    const { container } = render(<Skeleton className="h-8" />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('empty state shows its action', () => {
    render(
      <EmptyState
        title="Your watchlist is empty"
        description="Add stocks"
        action={<button>Add stock</button>}
      />,
    );
    expect(screen.getByText('Your watchlist is empty')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add stock' })).toBeInTheDocument();
  });

  it('retry button calls its handler', () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('error state without retry has no button', () => {
    render(<ErrorState title="Offline" description={null} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('Sparkline fluid area', () => {
  it('stretches and shades the area when asked', () => {
    const { container } = render(<Sparkline points={[1, 3, 2]} label="area" fluid area />);
    const svg = screen.getByRole('img', { name: 'area' });
    expect(svg).toHaveAttribute('preserveAspectRatio', 'none');
    expect(container.querySelectorAll('path')).toHaveLength(2);
  });
});
