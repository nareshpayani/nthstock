import type { Browser, CDPSession, Page } from '@playwright/test';

// Performance budgets and measurement for the @perf specs (T-169, T-170). They run on their own
// (`npm run e2e:perf`, one worker, the "Web vitals and render budgets" CI job) so no other test
// competes for the CPU while they measure.

/**
 * Lab Web Vitals budgets (CLAUDE.md §3). Lighthouse's desktop preset is the reference: TBT stands in
 * for INP (a lab run has no real input), with Lighthouse's desktop "good" limit.
 */
export const WEB_VITALS_BUDGETS = {
  /** Largest Contentful Paint, ms. */
  lcpMs: 2_000,
  /** Cumulative Layout Shift (largest session window). */
  cls: 0.05,
  /** Total Blocking Time from FCP until the page is settled, ms: the INP proxy. */
  tbtMs: 150,
} as const;

/** No main-thread task over this while prices tick (T-170): Chrome's long-task threshold. */
export const LONG_TASK_MS = 50;

/**
 * Lighthouse's desktop throttling (40 ms RTT, 10 Mbit/s down and up, no CPU slowdown), applied
 * with CDP so the page loads as Lighthouse would load it.
 */
export async function emulateLighthouseDesktop(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 40,
    downloadThroughput: (10 * 1024 * 1024) / 8,
    uploadThroughput: (10 * 1024 * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return cdp;
}

export type VitalsReport = {
  lcpMs: number | null;
  cls: number;
  tbtMs: number;
  fcpMs: number | null;
  longTasks: { startMs: number; durationMs: number }[];
};

/** Records LCP, layout shifts and long tasks from the first byte on (before any page script). */
export async function observeVitals(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Shift = PerformanceEntry & { value: number; hadRecentInput: boolean };
    const report = {
      lcp: null as number | null,
      cls: 0,
      longTasks: [] as { startMs: number; durationMs: number }[],
    };
    new PerformanceObserver((list) => {
      const last = list.getEntries().at(-1);
      if (last) report.lcp = last.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    // CLS as Chrome defines it: the largest session window (gaps < 1 s, windows ≤ 5 s).
    let windowValue = 0;
    let windowStart = 0;
    let previous = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Shift[]) {
        if (entry.hadRecentInput) continue;
        const same = entry.startTime - previous < 1_000 && entry.startTime - windowStart < 5_000;
        if (same) windowValue += entry.value;
        else {
          windowValue = entry.value;
          windowStart = entry.startTime;
        }
        previous = entry.startTime;
        report.cls = Math.max(report.cls, windowValue);
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        report.longTasks.push({ startMs: entry.startTime, durationMs: entry.duration });
      }
    }).observe({ type: 'longtask', buffered: true });
    (window as unknown as { vitals: typeof report }).vitals = report;
  });
}

/** Reads what `observeVitals` recorded. TBT counts each long task's time over 50 ms after FCP. */
export async function readVitals(page: Page): Promise<VitalsReport> {
  const raw = await page.evaluate(() => {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
    const { lcp, cls, longTasks } = (
      window as unknown as {
        vitals: { lcp: number | null; cls: number; longTasks: VitalsReport['longTasks'] };
      }
    ).vitals;
    return { fcp, lcp, cls, longTasks };
  });
  const from = raw.fcp ?? 0;
  const tbtMs = raw.longTasks
    .filter((task) => task.startMs + task.durationMs > from)
    .reduce((sum, task) => {
      const counted = task.durationMs - Math.max(0, from - task.startMs);
      return sum + Math.max(0, counted - LONG_TASK_MS);
    }, 0);
  return { lcpMs: raw.lcp, cls: raw.cls, tbtMs, fcpMs: raw.fcp, longTasks: raw.longTasks };
}

/** Waits for a frame and then `ms` of real time in the page. */
export async function settle(page: Page, ms: number): Promise<void> {
  await page.evaluate(
    (wait) => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, wait))),
    ms,
  );
}

type TraceEvent = {
  name: string;
  ph: string;
  pid: number;
  tid: number;
  ts: number;
  dur?: number;
  args?: { name?: string };
};

export type MainThreadTask = { startMs: number; durationMs: number };

/**
 * Tasks on the page's main thread (`CrRendererMain`) from a Chrome trace, longest first. `RunTask`
 * is one task of the thread's scheduler: what the Performance panel draws as a task, and what it
 * flags as long over 50 ms.
 */
export function mainThreadTasks(trace: Buffer): MainThreadTask[] {
  const { traceEvents } = JSON.parse(trace.toString('utf8')) as { traceEvents: TraceEvent[] };
  const mains = new Set(
    traceEvents
      .filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain')
      .map((e) => `${String(e.pid)}:${String(e.tid)}`),
  );
  const start = Math.min(...traceEvents.filter((e) => e.ts > 0).map((e) => e.ts));
  return traceEvents
    .filter(
      (e) =>
        e.ph === 'X' &&
        e.name === 'RunTask' &&
        e.dur !== undefined &&
        mains.has(`${String(e.pid)}:${String(e.tid)}`),
    )
    .map((e) => ({ startMs: (e.ts - start) / 1_000, durationMs: (e.dur ?? 0) / 1_000 }))
    .sort((a, b) => b.durationMs - a.durationMs);
}

/** Records a Chrome performance trace of `page` while `run` runs. */
export async function traceWhile(
  browser: Browser,
  page: Page,
  run: () => Promise<void>,
): Promise<Buffer> {
  await browser.startTracing(page, {
    categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'toplevel'],
  });
  // Tracing is stopped even when `run` throws, or the next test could not trace.
  const outcome = await run().then(
    () => null,
    (error: unknown) => ({ error }),
  );
  const trace = await browser.stopTracing();
  if (outcome) throw outcome.error;
  return trace;
}
