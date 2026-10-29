import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useViewportHeight } from './useViewportHeight';

afterEach(() => {
  vi.unstubAllGlobals();
});

const resizeTo = (next: number) => {
  vi.stubGlobal('innerHeight', next);
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
};

describe('useViewportHeight (NSTOCK-0465)', () => {
  it('starts on the window height and follows a resize', () => {
    vi.stubGlobal('innerHeight', 844);
    const { result } = renderHook(() => useViewportHeight());
    expect(result.current).toBe(844);
    resizeTo(390);
    expect(result.current).toBe(390);
  });

  it('does not re-render on a resize that keeps the height', () => {
    vi.stubGlobal('innerHeight', 700);
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useViewportHeight();
    });
    const before = renders;
    resizeTo(700);
    expect(renders).toBe(before);
  });

  it('reads the height once per render pass, not on every render', () => {
    const spy = vi.fn(() => 600);
    Object.defineProperty(window, 'innerHeight', { configurable: true, get: spy });
    const { rerender } = renderHook(() => useViewportHeight());
    const reads = spy.mock.calls.length;
    rerender();
    rerender();
    expect(spy.mock.calls.length).toBe(reads);
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 768,
    });
  });

  it('forgets the height once nothing listens, so the next mount reads it afresh', () => {
    vi.stubGlobal('innerHeight', 844);
    renderHook(() => useViewportHeight()).unmount();
    vi.stubGlobal('innerHeight', 412);
    const { result } = renderHook(() => useViewportHeight());
    expect(result.current).toBe(412);
  });

  it('stops listening on unmount', () => {
    vi.stubGlobal('innerHeight', 500);
    const remove = vi.spyOn(window, 'removeEventListener');
    renderHook(() => useViewportHeight()).unmount();
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    remove.mockRestore();
  });
});
