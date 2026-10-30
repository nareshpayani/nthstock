import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { celebrateOrder, subscribeOrderCelebrations } from '@/shared/motion/orderCelebration';
import { CELEBRATION_MS, OrderCelebrationOverlay, REDUCED_MS } from './OrderCelebrationOverlay';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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
    // The first order's timer was dropped: the fill gets its full time.
    act(() => vi.advanceTimersByTime(CELEBRATION_MS - 300));
    expect(screen.getByTestId('order-celebration')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(100));
    expect(screen.queryByTestId('order-celebration')).toBeNull();
  });

  it('with reduced motion is a short fade of the finished mark', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const animate = vi.fn(() => ({ cancel: vi.fn() }));
    const original = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = animate as unknown as typeof original;
    try {
      render(<OrderCelebrationOverlay />);
      act(() => celebrateOrder('placed'));
      expect(animate).toHaveBeenCalledOnce();
      act(() => vi.advanceTimersByTime(REDUCED_MS));
      expect(screen.queryByTestId('order-celebration')).toBeNull();
    } finally {
      HTMLElement.prototype.animate = original;
      vi.unstubAllGlobals();
    }
  });

  it('a failing listener does not stop the order flow', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const off = subscribeOrderCelebrations(() => {
      throw new Error('boom');
    });
    expect(() => celebrateOrder('placed')).not.toThrow();
    off();
  });
});
