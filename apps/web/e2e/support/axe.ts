import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, type Page } from '@playwright/test';

// axe-core in Playwright (T-166). axe-core is already installed (the Storybook a11y addon brings
// it), so its browser build is injected into the page directly, with no Playwright wrapper
// package. The same rule set as WCAG 2.2 AA.
const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

type AxeNode = { target: unknown[]; html: string; failureSummary?: string };
type AxeViolation = { id: string; impact?: string | null; help: string; nodes: AxeNode[] };
type AxeWindow = {
  axe?: {
    run(context: Element | Document, options: object): Promise<{ violations: AxeViolation[] }>;
  };
};

/**
 * Runs axe on the page, or inside `scope` (a CSS selector), and fails on any serious or critical
 * violation, listing each with the elements it hit.
 */
export async function expectNoSeriousA11yViolations(
  page: Page,
  label: string,
  scope?: string,
): Promise<void> {
  const loaded = await page.evaluate(() => Boolean((window as AxeWindow).axe));
  if (!loaded) await page.addScriptTag({ content: AXE_SOURCE });
  const violations = await page.evaluate(
    async ({ tags, scope }) => {
      const axe = (window as AxeWindow).axe;
      if (!axe) throw new Error('axe-core did not load');
      const context = scope ? document.querySelector(scope) : document;
      if (!context) throw new Error(`No element matches ${scope ?? ''}`);
      const results = await axe.run(context, {
        runOnly: { type: 'tag', values: tags },
        resultTypes: ['violations'],
      });
      return results.violations;
    },
    { tags: WCAG_TAGS, scope },
  );
  const serious = violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map(
      (violation) =>
        `${violation.impact ?? ''} ${violation.id}: ${violation.help} → ${violation.nodes
          .slice(0, 5)
          .map(
            (node) => `${JSON.stringify(node.target)} ${node.html} (${node.failureSummary ?? ''})`,
          )
          .join('; ')}`,
    );
  expect(serious, `serious or critical axe violations on ${label}`).toEqual([]);
}
