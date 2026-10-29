import type { AnyRouter } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

/** A fresh copy of the module: its painted signal is once per page load. */
const load = () => import('./firstPaint');

/** A router whose URL matches one route, whose code loads when `chunk` settles. */
function routerWith(chunk: Promise<void>) {
  const route = { id: '/page' };
  return {
    latestLocation: { pathname: '/page' },
    matchRoutes: () => [{ routeId: '/page' }],
    routesById: { '/page': route },
    loadRouteChunk: (loaded: unknown) => (loaded === route ? chunk : undefined),
  } as unknown as AnyRouter;
}

function Page({ mark }: { mark: () => void }) {
  mark();
  return null;
}

describe('afterFirstPaint (NSTOCK-0469)', () => {
  it('waits for the first screen to paint and the route code to load, then a paint', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'requestAnimationFrame'] });
    const { afterFirstPaint, useMarkFirstPaint } = await load();
    let loadChunk: () => void = () => undefined;
    const chunk = new Promise<void>((resolve) => {
      loadChunk = resolve;
    });
    const done = vi.fn();
    void afterFirstPaint(routerWith(chunk), 1000).then(done);
    render(<Page mark={useMarkFirstPaint} />);
    await vi.advanceTimersByTimeAsync(100);
    expect(done).not.toHaveBeenCalled();
    loadChunk();
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('resolves at the cap when the first screen never marks itself painted', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'requestAnimationFrame'] });
    const { afterFirstPaint } = await load();
    const done = vi.fn();
    void afterFirstPaint(routerWith(Promise.resolve()), 1000).then(done);
    await vi.advanceTimersByTimeAsync(999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
