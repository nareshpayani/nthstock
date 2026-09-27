// The `?demo=1` parameter (T-174), apart from the seed itself: main.tsx reads and drops it before
// the router starts, without loading the MSW chunk, so the router never sees it (T-169).

/** `?demo=1` asks for the demo seed. */
export const DEMO_QUERY_PARAM = 'demo';

export function wantsDemo(search: string): boolean {
  return new URLSearchParams(search).get(DEMO_QUERY_PARAM) === '1';
}

/** The URL without `demo=1`, so a reload keeps the demo's changes instead of seeding again. */
export function withoutDemoParam(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(DEMO_QUERY_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}
