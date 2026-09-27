import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PnlAmount, signedInr } from './PnlAmount';

describe('PnlAmount', () => {
  it('shows ▲ and a + sign for a profit, with a spoken label, not colour alone', () => {
    const { container } = render(<PnlAmount value={1_23_456_50} basisPoints={125} />);
    const root = container.firstElementChild;
    expect(root).toHaveAttribute('data-direction', 'up');
    expect(root).toHaveClass('text-up');
    expect(root).toHaveTextContent('▲ +₹1,23,456.50 (1.25%)');
    expect(root).toHaveTextContent('profit ₹1,23,456.50, up 1.25 percent');
  });

  it('shows ▼ and a − sign for a loss, and a dot for nothing', () => {
    const loss = render(<PnlAmount value={-12_30} basisPoints={-50} size="sm" />).container;
    expect(loss.firstElementChild).toHaveAttribute('data-direction', 'down');
    expect(loss).toHaveTextContent('▼ -₹12.30 (-0.50%)');
    expect(loss).toHaveTextContent('loss ₹12.30, down 0.50 percent');
    const flat = render(<PnlAmount value={0} size="lg" />).container;
    expect(flat).toHaveTextContent('● ₹0.00');
    expect(flat).toHaveTextContent('no profit or loss');
  });

  it('signs amounts in text', () => {
    expect(signedInr(5)).toBe('+₹0.05');
    expect(signedInr(-5)).toBe('-₹0.05');
    expect(signedInr(0)).toBe('₹0.00');
  });
});
