# Before: the mobile Trade from Charts flow on 28 Oct 2026

The "before" set for [DESIGN.md](../../../DESIGN.md) (SPEC-CR-1 §11, CR-T01, G3), captured from
`develop` at `cd5c1b7`, before any craft-round change. Every row of the viewport matrix
(`apps/web/e2e/support/viewportMatrix.ts`) has three frames, each the visible screen only:

| Frame | File | What it shows |
|---|---|---|
| Instrument | `<viewport>-instrument.jpg` | The stock page as it first shows |
| Ticket | `<viewport>-ticket.jpg` | The order ticket open after tapping Buy |
| Order line | `<viewport>-orderLine.jpg` | The chart with a working buy limit line |

`<viewport>.json` lists the frames that could be reached. The recording `flow-390x844.mp4` (and
its last frame) shows a thumb pressing 6 px above the order line's label: the crosshair wakes and the
line does not move.

Recapture with `apps/web/playwright.design.config.ts` (instructions in the file).

## What the set shows

| Viewport | Finding |
|---|---|
| 320 × 640 | The page is wider than the screen; the Buy button can't be reached, so no ticket or order line frame |
| 360 × 740 and up (phones) | The chart starts below the fold; the ticker clips SENSEX |
| Every phone | The ticket's primary button is below the fold; Buy is green in the trade bar, blue on the chart |
| 390 × 844 recording | A press just off the label wakes the crosshair; the line stays put |
| 844 × 390 (landscape) | Only the header and price fit; no chart above the fold |
| 673 to 1180 wide (foldable, tablets) | The desktop card layout: green Buy, red Sell, chart below the fold on the foldable |
