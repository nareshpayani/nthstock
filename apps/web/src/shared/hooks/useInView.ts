import { useEffect, useState, type RefObject } from 'react';

/**
 * True while any part of `ref`'s element is inside the viewport, via IntersectionObserver.
 * Starts true (the element is usually on screen when it mounts) and stays true where the
 * browser has no IntersectionObserver, so callers never stall.
 */
export function useInView(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      const latest = entries[entries.length - 1];
      if (latest) setInView(latest.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}
