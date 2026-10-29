import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IstClock } from './IstClock';

describe('IstClock (NSTOCK-0463)', () => {
  afterEach(() => vi.useRealTimers());

  it('ticks each second in IST and stops when unmounted', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-10-29T15:15:12Z'));
    const { unmount } = render(<IstClock />);
    const clock = screen.getByTestId('ist-clock');
    expect(clock).toHaveAttribute('aria-hidden', 'true');
    expect(clock).toHaveTextContent(/08:45:12 pm IST/i);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(clock).toHaveTextContent(/08:45:13 pm IST/i);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(clock).toHaveTextContent(/08:45:13 pm IST/i);
  });

  it('gives screen readers the time to the minute, never as a live region', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-10-29T15:15:12Z'));
    render(<IstClock />);
    const label = screen.getByTestId('ist-clock-label');
    expect(label).toHaveTextContent(/^Time 08:45 pm IST$/i);
    expect(label).not.toHaveAttribute('aria-live');
    expect(label).not.toHaveAttribute('role');
    expect(label.closest('[aria-live],[role="status"]')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(label).toHaveTextContent(/^Time 08:45 pm IST$/i);
  });
});
