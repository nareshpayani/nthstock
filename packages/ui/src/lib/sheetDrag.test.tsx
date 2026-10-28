import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from '../components/Dialog.js';

/** A pointer event with the fields jsdom leaves out: pointerId, clientY and a set timeStamp. */
function pointer(target: Element, type: string, clientY: number, timeStamp: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  fireEvent(target, event);
}

function renderSheet(onOpenChange = vi.fn()) {
  render(
    <Sheet open onOpenChange={onOpenChange} side="bottom" title="Buy INFY">
      <p>Ticket</p>
    </Sheet>,
  );
  const panel = screen.getByRole('dialog');
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ height: 400 } as DOMRect);
  const grabber = panel.querySelector('[data-part="sheet-grabber"]');
  if (!grabber) throw new Error('no grabber');
  return { panel, grabber, onOpenChange };
}

describe('bottom sheet drag to dismiss (SPEC-CR-1 §5.5, CR-T10)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows the finger, and closes when let go past 30% of its height', () => {
    const { panel, grabber, onOpenChange } = renderSheet();
    pointer(grabber, 'pointerdown', 100, 0);
    pointer(grabber, 'pointermove', 180, 400);
    expect(panel.style.transform).toBe('translateY(80px)');
    pointer(grabber, 'pointermove', 240, 800);
    pointer(grabber, 'pointerup', 240, 800);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('springs back when let go slowly below the threshold', () => {
    const { panel, grabber, onOpenChange } = renderSheet();
    pointer(grabber, 'pointerdown', 100, 0);
    pointer(grabber, 'pointermove', 160, 600);
    pointer(grabber, 'pointerup', 160, 1200);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(panel.style.transform).toBe('');
    expect(panel.style.transition).toContain('var(--nth-duration-slow)');
  });

  it('closes on a fast downward flick however short', () => {
    const { grabber, onOpenChange } = renderSheet();
    pointer(grabber, 'pointerdown', 100, 0);
    pointer(grabber, 'pointermove', 110, 10);
    pointer(grabber, 'pointermove', 160, 60);
    pointer(grabber, 'pointerup', 160, 60);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('resists an upward pull and never closes from it', () => {
    const { panel, grabber, onOpenChange } = renderSheet();
    pointer(grabber, 'pointerdown', 300, 0);
    pointer(grabber, 'pointermove', 200, 100);
    expect(panel.style.transform).toBe('translateY(-25px)');
    pointer(grabber, 'pointerup', 200, 100);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('a press on the header Close is a tap, not a drag; a cancelled pointer springs back', () => {
    const { panel, grabber, onOpenChange } = renderSheet();
    const close = screen.getByRole('button', { name: 'Close' });
    pointer(close, 'pointerdown', 50, 0);
    pointer(close, 'pointermove', 300, 10);
    expect(panel.style.transform).toBe('');

    pointer(grabber, 'pointerdown', 100, 0);
    pointer(grabber, 'pointermove', 300, 10);
    pointer(grabber, 'pointercancel', 300, 10);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(panel.style.transform).toBe('');
  });

  it('with reduced motion the sheet returns without easing', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { panel, grabber } = renderSheet();
    pointer(grabber, 'pointerdown', 100, 0);
    pointer(grabber, 'pointermove', 150, 600);
    pointer(grabber, 'pointerup', 150, 1200);
    expect(panel.style.transform).toBe('');
    expect(panel.style.transition).toBe('');
  });

  it('springs back when the parent ignores the close', async () => {
    const { panel, grabber, onOpenChange } = renderSheet();
    pointer(grabber, 'pointerdown', 100, 0);
    pointer(grabber, 'pointermove', 300, 400);
    pointer(grabber, 'pointerup', 300, 800);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => {
      expect(panel.style.transform).toBe('');
    });
  });

  it('closes just past 30% and not just under it', () => {
    const under = renderSheet();
    pointer(under.grabber, 'pointerdown', 100, 0);
    pointer(under.grabber, 'pointermove', 219, 1000);
    pointer(under.grabber, 'pointerup', 219, 2000);
    expect(under.onOpenChange).not.toHaveBeenCalled();
    cleanup();
    const over = renderSheet();
    pointer(over.grabber, 'pointerdown', 100, 0);
    pointer(over.grabber, 'pointermove', 221, 1000);
    pointer(over.grabber, 'pointerup', 221, 2000);
    expect(over.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('ignores a flick when the finger rested before lifting', () => {
    const { grabber, onOpenChange } = renderSheet();
    pointer(grabber, 'pointerdown', 100, 0);
    pointer(grabber, 'pointermove', 110, 10);
    pointer(grabber, 'pointermove', 160, 60);
    pointer(grabber, 'pointerup', 160, 500);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('a drag after the sheet closed mid-drag works again', () => {
    const ui = (open: boolean) => (
      <Sheet open={open} onOpenChange={vi.fn()} side="bottom" title="Buy INFY">
        <p>Ticket</p>
      </Sheet>
    );
    const { rerender } = render(ui(true));
    const grab = () => {
      const element = screen.getByRole('dialog').querySelector('[data-part="sheet-grabber"]');
      if (!element) throw new Error('no grabber');
      return element;
    };
    pointer(grab(), 'pointerdown', 100, 0);
    pointer(grab(), 'pointermove', 150, 100);
    rerender(ui(false));
    rerender(ui(true));
    pointer(grab(), 'pointerdown', 100, 0);
    pointer(grab(), 'pointermove', 150, 100);
    expect(screen.getByRole('dialog').style.transform).toBe('translateY(50px)');
  });

  it('returns focus to the trigger after a drag close, and Escape still closes', async () => {
    render(
      <Sheet trigger={<button>Open</button>} side="bottom" title="Buy INFY">
        <button>Inside</button>
      </Sheet>,
    );
    const trigger = screen.getByRole('button', { name: 'Open' });
    trigger.focus();
    fireEvent.click(trigger);
    const panel = screen.getByRole('dialog');
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ height: 400 } as DOMRect);
    const grabber = panel.querySelector('[data-part="sheet-grabber"]');
    if (!grabber) throw new Error('no grabber');
    pointer(grabber, 'pointerdown', 100, 0);
    pointer(grabber, 'pointermove', 300, 400);
    pointer(grabber, 'pointerup', 300, 800);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
