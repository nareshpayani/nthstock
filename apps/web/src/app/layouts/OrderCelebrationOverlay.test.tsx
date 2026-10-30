import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { celebrateOrder } from '@/shared/motion/orderCelebration';
import { CELEBRATION_MS, OrderCelebrationOverlay } from './OrderCelebrationOverlay';

afterEach(() => {
  vi.useRealTimers();
});

describe('order-placed moment', () => {
  it('shows the nth mark with the outcome, hidden from screen readers, then goes', () => {
    vi.useFakeTimers();
    render(<OrderCelebrationOverlay />);
    expect(screen.queryByTestId('order-celebration')).toBeNull();

    act(() => celebrateOrder('placed'));
    const overlay = screen.getByTestId('order-celebration');
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
    expect(overlay).toHaveTextContent('Order placed');
    expect(overlay.querySelector('[data-part="rise"]')).not.toBeNull();

    act(() => vi.advanceTimersByTime(CELEBRATION_MS));
    expect(screen.queryByTestId('order-celebration')).toBeNull();
  });

  it('a fill says so, and a new order restarts the moment', () => {
    vi.useFakeTimers();
    render(<OrderCelebrationOverlay />);
    act(() => celebrateOrder('placed'));
    act(() => vi.advanceTimersByTime(CELEBRATION_MS - 100));
    act(() => celebrateOrder('filled'));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByTestId('order-celebration')).toHaveTextContent('Order filled');
  });
});
