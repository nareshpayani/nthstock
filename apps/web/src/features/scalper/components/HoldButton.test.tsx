import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS, HoldButton } from './HoldButton';

function renderHold(ready = true) {
  const onHold = vi.fn();
  render(
    <>
      <HoldButton ready={ready} onHold={onHold} describedBy="hint" testId="hold">
        Reverse
      </HoldButton>
      <span id="hint">Hold to reverse</span>
    </>,
  );
  return { onHold, button: screen.getByRole('button', { name: 'Reverse' }) };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('hold button (T22, SPEC-TFC-1 §11.3)', () => {
  it('acts only once it has been held for 400 ms, and the ring runs meanwhile', () => {
    const { onHold, button } = renderHold();
    fireEvent.pointerDown(button, { button: 0 });
    expect(button).toHaveAttribute('data-holding', 'true');
    act(() => vi.advanceTimersByTime(HOLD_MS - 1));
    expect(onHold).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onHold).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute('data-holding', 'false');
    fireEvent.pointerUp(button);
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it('letting go, sliding off or a cancelled touch before 400 ms sends nothing', () => {
    const { onHold, button } = renderHold();
    for (const release of [fireEvent.pointerUp, fireEvent.pointerLeave, fireEvent.pointerCancel]) {
      fireEvent.pointerDown(button, { button: 0 });
      act(() => vi.advanceTimersByTime(HOLD_MS - 50));
      release(button);
      act(() => vi.advanceTimersByTime(HOLD_MS));
    }
    expect(onHold).not.toHaveBeenCalled();
  });

  it('a click is not a hold', () => {
    const { onHold, button } = renderHold();
    fireEvent.click(button);
    act(() => vi.advanceTimersByTime(HOLD_MS * 2));
    expect(onHold).not.toHaveBeenCalled();
  });

  it('keyboard users hold Enter or Space; key repeats do not restart it', () => {
    const { onHold, button } = renderHold();
    button.focus();
    fireEvent.keyDown(button, { key: 'Enter' });
    act(() => vi.advanceTimersByTime(HOLD_MS / 2));
    fireEvent.keyDown(button, { key: 'Enter', repeat: true });
    act(() => vi.advanceTimersByTime(HOLD_MS / 2));
    expect(onHold).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(button, { key: 'Enter' });

    fireEvent.keyDown(button, { key: ' ' });
    act(() => vi.advanceTimersByTime(HOLD_MS - 100));
    fireEvent.keyUp(button, { key: ' ' });
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onHold).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(button, { key: ' ' });
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onHold).toHaveBeenCalledTimes(2);
  });

  it('losing focus mid-hold cancels it', () => {
    const { onHold, button } = renderHold();
    button.focus();
    fireEvent.keyDown(button, { key: 'Enter' });
    act(() => vi.advanceTimersByTime(HOLD_MS - 100));
    fireEvent.blur(button);
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onHold).not.toHaveBeenCalled();
  });

  it('not ready, holding does nothing', () => {
    const { onHold, button } = renderHold(false);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    fireEvent.pointerDown(button, { button: 0 });
    act(() => vi.advanceTimersByTime(HOLD_MS * 2));
    expect(onHold).not.toHaveBeenCalled();
    expect(button).toHaveAccessibleDescription('Hold to reverse');
  });
});
