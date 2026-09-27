import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

const isVisible = () => document.visibilityState !== 'hidden';
const serverVisible = () => true;

/** False while the browser tab is hidden (another tab in front, window minimised). */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, isVisible, serverVisible);
}
