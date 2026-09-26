import { useEffect } from 'react';

export const APP_NAME = 'nthstock';

/** "Infosys Ltd (INFY)" → "Infosys Ltd (INFY) · nthstock". */
export const documentTitle = (page: string) => `${page} · ${APP_NAME}`;

/**
 * Sets the browser tab title while the calling page is mounted and puts the previous title back
 * when it unmounts, so a page without its own title never shows a stale one.
 */
export function useDocumentTitle(page: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = documentTitle(page);
    return () => {
      document.title = previous;
    };
  }, [page]);
}
