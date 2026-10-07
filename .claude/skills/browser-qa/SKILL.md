---
name: browser-qa
description: Drive the running nthstock web app in a real browser to check a change works for a user (smoke, interactions, both widths, keyboard and axe), with screenshots and a ship verdict. Use after a UI change, before asking the owner to review a frontend PR, or when asked to check the app in the browser.
---

# Browser QA

Tests prove the code; this proves the screen. Use the Playwright MCP tools when you have them,
otherwise a throwaway Playwright script outside the repo, or extend a spec in `apps/web/e2e/`
when the check should stay.

## 0. Start the app
Mock mode (the `local-dev` skill): `npm run dev -w @nthstock/web`, then open
http://localhost:5173/?demo=1 and log in as 9000000001 with OTP 123456. Use only demo data; never
real credentials. Wait for the MSW worker before judging blank cards.

## 1. Smoke (each page the change touches)
- No console errors (MSW and React DevTools notices are noise) and no 4xx/5xx except ones the page
  handles on purpose.
- Screenshots at **1440×900** and **390×844**, the widths the owner reviews. Save them under
  `/mnt/project-files/nthstock/screenshots/` when working in the project, not in the repo.
- Prices tick: values change and the ▲▼ indicator follows without layout shift.

## 2. Interactions
- Every link and tab the change touches goes where it says; URL search params update.
- Forms: submit valid input (success state), then invalid input (error tied to the field).
- Main journey if touched: login → dashboard → stock detail → order ticket → order book →
  portfolio, the same path as `goldenPath.spec.ts`. Paper money only, so placing orders is fine.
- Failure states: block the API route (or use the MSW error scenario) and check the section shows
  "unavailable" with a retry, not ₹0 or an empty list.

## 3. Accessibility
- Inject axe (`apps/web/e2e/support/axe.ts` shows how) and report WCAG 2.2 AA violations.
- Keyboard only: reach and operate every control, see the focus ring, Escape closes dialogs and
  focus returns to the trigger.
- Order results and errors are announced (`role="status"`/`role="alert"`).
- axe finds about a third of WCAG issues; a clean run alone is not "accessible".

## 4. Report
```
QA: <page or PR> — <verdict>
Smoke:        console 0 errors · network ok · screenshots 1440, 390
Interactions: [✓] … / [✗] … (file:line if you know it)
A11y:         axe 0 violations · keyboard ok · announcements ok
Verdict:      SHIP | SHIP WITH FIXES (n issues) | DO NOT SHIP
```
Attach the screenshots. Use INCONCLUSIVE when something could not be checked, and say what.

Adapted from ECC `skills/browser-qa` (MIT, see `../../third-party-notices.md`).
