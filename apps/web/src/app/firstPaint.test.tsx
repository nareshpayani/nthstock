import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

/** A fresh copy of the module: its painted signal is once per page load. */
const load = () => import('./firstPaint');

describe('afterFirstPaint (NSTOCK-0469)', () => {
  it('resolves the frame after the first page commits, before the cap', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'requestAnimationFrame'] });
    const { afterFirstPaint, useMarkFirstPaint } = await load();
    const done = vi.fn();
    void afterFirstPaint(1000).then(done);
    function Page() {
      useMarkFirstPaint();
      return null;
    }
    render(<Page />);
    await vi.advanceTimersByTimeAsync(50);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('resolves at the cap when no page marks itself painted', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'requestAnimationFrame'] });
    const { afterFirstPaint } = await load();
    const done = vi.fn();
    void afterFirstPaint(1000).then(done);
    await vi.advanceTimersByTimeAsync(999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
