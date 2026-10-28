import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useKeyboardInset } from './keyboardInset.js';

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
  afterEach(() => {
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

  it('does nothing when off or where there is no visual viewport', () => {
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
    const { getByTestId } = render(<Panel enabled />);
    expect(getByTestId('panel')).not.toHaveAttribute('data-keyboard');
  });
});
