import { useSyncExternalStore } from 'react';

// The window's height, read on resize rather than on every render: `innerHeight` forces a layout
// when the DOM has changed, and useSyncExternalStore reads its snapshot again after each commit,
// so reading it there cost the instrument page a forced layout per render while it loaded.
let height: number | undefined;

const read = () => (height ??= window.innerHeight);

const subscribe = (onChange: () => void) => {
  const update = () => {
    const next = window.innerHeight;
    if (next === height) return;
    height = next;
    onChange();
  };
  // Subscribed after paint, when a read costs nothing: catches a change since the first read.
  update();
  window.addEventListener('resize', update);
  return () => window.removeEventListener('resize', update);
};

/** The viewport height in px, kept current on resize; 800 on the server. */
export function useViewportHeight(): number {
  return useSyncExternalStore(subscribe, read, () => 800);
}
