import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLLAPSED_KEY, WatchlistSection } from './WatchlistSection';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('WatchlistSection', () => {
  it('shows the empty state with Add stock', () => {
    const onAddStock = vi.fn();
    render(<WatchlistSection onAddStock={onAddStock} />);
    expect(screen.getByText('Your watchlist is empty')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Add stock' }));
    expect(onAddStock).toHaveBeenCalledOnce();
  });

  it('remembers the collapsed state in localStorage', () => {
    const { unmount } = render(<WatchlistSection onAddStock={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: /My Watchlist/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(window.localStorage.getItem(COLLAPSED_KEY)).toBe('1');
    unmount();

    render(<WatchlistSection onAddStock={vi.fn()} />);
    expect(screen.getByRole('button', { name: /My Watchlist/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('Your watchlist is empty')).not.toBeVisible();
  });

  it('still renders and toggles when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    render(<WatchlistSection onAddStock={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: /My Watchlist/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
