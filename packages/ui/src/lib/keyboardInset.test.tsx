import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncSheetMaxHeight, useKeyboardInset } from './keyboardInset.js';

class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
}

function Panel({ enabled }: { enabled: boolean }) {
  const ref = useKeyboardInset(enabled);
  return <div ref={ref} data-testid="panel" />;
}

describe('useKeyboardInset (SPEC-CR-1 §5.5)', () => {
  const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
      run(0);
      return 1;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (original) Object.defineProperty(window, 'visualViewport', original);
    else Reflect.deleteProperty(window, 'visualViewport');
  });

  it('lifts the sheet by the keyboard and caps its height, then lets go', () => {
    const viewport = new FakeViewport();
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    const { getByTestId } = render(<Panel enabled />);
    const panel = getByTestId('panel');
    expect(panel.style.bottom).toBe('');
    viewport.height = 460;
    viewport.dispatchEvent(new Event('resize'));
    expect(panel.style.bottom).toBe('340px');
    expect(panel.style.maxHeight).toBe('414px');
    expect(panel).toHaveAttribute('data-keyboard', 'open');
    viewport.height = 800;
    viewport.dispatchEvent(new Event('resize'));
    expect(panel.style.bottom).toBe('');
    expect(panel).toHaveAttribute('data-keyboard', 'closed');
  });

  it('keeps the full detent when the keyboard opens and closes', () => {
    const viewport = new FakeViewport();
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    const { getByTestId } = render(<Panel enabled />);
    const panel = getByTestId('panel');
    panel.dataset.detent = 'full';
    viewport.height = 460;
    viewport.dispatchEvent(new Event('resize'));
    expect(panel.style.maxHeight).toBe('448px');
    viewport.height = 800;
    viewport.dispatchEvent(new Event('resize'));
    expect(panel.style.maxHeight).toContain('100dvh');
    expect(panel).toHaveAttribute('data-detent', 'full');
  });

  it('a detent change while the keyboard is open keeps the keyboard cap', () => {
    const viewport = new FakeViewport();
    viewport.height = 460;
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    const { getByTestId } = render(<Panel enabled />);
    const panel = getByTestId('panel');
    panel.dataset.detent = 'compact';
    syncSheetMaxHeight(panel);
    expect(panel.style.maxHeight).toBe('414px');
  });

  it('subtracts the visual viewport offset from the inset', () => {
    const viewport = new FakeViewport();
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    const { getByTestId } = render(<Panel enabled />);
    viewport.height = 460;
    viewport.offsetTop = 100;
    viewport.dispatchEvent(new Event('scroll'));
    expect(getByTestId('panel').style.bottom).toBe('240px');
  });

  it('lets go of the sheet when turned off', () => {
    const viewport = new FakeViewport();
    viewport.height = 460;
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    const { getByTestId, rerender } = render(<Panel enabled />);
    expect(getByTestId('panel').style.bottom).toBe('340px');
    rerender(<Panel enabled={false} />);
    const panel = getByTestId('panel');
    expect(panel.style.bottom).toBe('');
    expect(panel.style.maxHeight).toBe('');
    expect(panel).not.toHaveAttribute('data-keyboard');
  });

  it('does nothing when off or where there is no visual viewport', () => {
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
    const { getByTestId } = render(<Panel enabled />);
    expect(getByTestId('panel')).not.toHaveAttribute('data-keyboard');
  });
});
