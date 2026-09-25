import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { isTypingTarget, useShortcut } from './useShortcut';

function Harness({ onSlash, enabled = true }: { onSlash: () => void; enabled?: boolean }) {
  useShortcut('/', onSlash, { enabled });
  return (
    <>
      <input aria-label="Search" />
      <input aria-label="Agree" type="checkbox" />
      <textarea aria-label="Notes" />
      <div aria-label="Editor" contentEditable suppressContentEditableWarning />
      <button type="button">Plain</button>
    </>
  );
}

describe('useShortcut', () => {
  it('fires on the page', () => {
    const onSlash = vi.fn();
    render(<Harness onSlash={onSlash} />);
    fireEvent.keyDown(document.body, { key: '/' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Plain' }), { key: '/' });
    expect(onSlash).toHaveBeenCalledTimes(2);
  });

  it('does not fire when / is typed inside an input, textarea or editable element', () => {
    const onSlash = vi.fn();
    render(<Harness onSlash={onSlash} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search' }), { key: '/' });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Notes' }), { key: '/' });
    fireEvent.keyDown(screen.getByLabelText('Editor'), { key: '/' });
    expect(onSlash).not.toHaveBeenCalled();
  });

  it('ignores modifiers, other keys and disabled shortcuts', () => {
    const onSlash = vi.fn();
    const { rerender } = render(<Harness onSlash={onSlash} />);
    fireEvent.keyDown(document.body, { key: '/', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: '/', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'a' });
    rerender(<Harness onSlash={onSlash} enabled={false} />);
    fireEvent.keyDown(document.body, { key: '/' });
    expect(onSlash).not.toHaveBeenCalled();
  });

  it('treats checkboxes as non-typing targets', () => {
    render(<Harness onSlash={vi.fn()} />);
    expect(isTypingTarget(screen.getByRole('checkbox', { name: 'Agree' }))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
