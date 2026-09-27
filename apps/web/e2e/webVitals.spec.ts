import { expect, test } from '@playwright/test';
import { PERF_TAG } from './support/env';
import {
  WEB_VITALS_BUDGETS,
  emulateLighthouseDesktop,
  observeVitals,
  readVitals,
  settle,
} from './support/perf';

// T-169: lab Web Vitals budgets for the dashboard and stock detail, enforced in CI by the "Web
// vitals and render budgets" job (npm run e2e:perf): LCP under 2.0 s, CLS under 0.05, and TBT
// (the INP proxy) under Lighthouse's desktop "good" limit. Each page loads cold, in a fresh
// context, under Lighthouse's desktop throttling, from the production msw-mode build, so the
// service worker install and the MSW start count against the budget too.

const PAGES = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'stock detail', path: '/stocks/INFY' },
] as const;

for (const { name, path } of PAGES) {
  test(`${name} meets the Web Vitals budgets ${PERF_TAG}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await emulateLighthouseDesktop(page);
    await observeVitals(page);

    await page.goto(path);
    await expect(page.getByRole('main')).toBeVisible();
    await page.waitForLoadState('networkidle');
    // Late work (fonts, the lazy chart's first paint, the first ticks) lands before reading.
    await settle(page, 2_000);

    const vitals = await readVitals(page);
    await testInfo.attach(`web-vitals-${name.replace(' ', '-')}`, {
      body: JSON.stringify({ budgets: WEB_VITALS_BUDGETS, vitals }, null, 2),
      contentType: 'application/json',
    });
    const summary = `${name}: LCP ${String(Math.round(vitals.lcpMs ?? -1))} ms, CLS ${vitals.cls.toFixed(3)}, TBT ${String(Math.round(vitals.tbtMs))} ms`;
    console.info(summary);

    expect(vitals.lcpMs, `${summary}: no LCP recorded`).not.toBeNull();
    expect(vitals.lcpMs ?? Infinity, summary).toBeLessThan(WEB_VITALS_BUDGETS.lcpMs);
    expect(vitals.cls, summary).toBeLessThan(WEB_VITALS_BUDGETS.cls);
    expect(vitals.tbtMs, summary).toBeLessThan(WEB_VITALS_BUDGETS.tbtMs);
  });
}
