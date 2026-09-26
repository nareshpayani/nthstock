import { useEffect, useRef } from 'react';

export type ShortcutOptions = {
  enabled?: boolean;
};

/** True when the key press happens while typing, so single-key shortcuts must not fire. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // isContentEditable is missing in some DOM implementations, so check the attribute too.
  if (
    target.isContentEditable ||
    target.closest('[contenteditable]:not([contenteditable="false"])')
  ) {
    return true;
  }
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color'].includes(type);
}

/**
 * Global single-key shortcut (e.g. "/" for search, "?" for help). Ignores key presses inside
 * inputs, with Ctrl/Cmd/Alt held, or already handled by another listener.
 */
export function useShortcut(
  key: string,
  handler: (event: KeyboardEvent) => void,
  { enabled = true }: ShortcutOptions = {},
): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== key || event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      handlerRef.current(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [key, enabled]);
}
