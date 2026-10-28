# After: the mobile Trade from Charts flow at the end of the craft round

The "after" set for [DESIGN.md](../../../DESIGN.md) (SPEC-CR-1 §11, CR-T23). It was captured from
`develop` after the last craft-round change, with the same script and at the same sizes as the
[before set](../before/README.md). Every row of the viewport matrix
(`apps/web/e2e/support/viewportMatrix.ts`) has three frames, each the visible screen only:

| Frame | File | What it shows |
|---|---|---|
| Instrument | `<viewport>-instrument.jpg` | The stock page as it first shows |
| Ticket | `<viewport>-ticket.jpg` | The order ticket open after tapping Buy |
| Order line | `<viewport>-orderLine.jpg` | The chart with a working buy limit line |

`<viewport>.json` lists the frames that were reached. All three frames were reached at every size,
including 320 × 640, where the before set could not reach the ticket. The phone recording of the
flow is made on a real iPhone ([recording script](../recordingScript.md)).

Recapture with `apps/web/playwright.design.config.ts` (instructions in the file), with
`DESIGN_OUT=../../docs/design/after`.

## What the set shows

| Viewport | Change |
|---|---|
| 320 × 640 | Fits the screen: no sideways scroll, and Sell and Buy are in the dock |
| 360 × 740 and up (phones) | The chart is above the fold under a compact price block; the ticker shows NIFTY 50 and SENSEX without clipping |
| Every phone | The compact ticket fits, with **Buy INFY** pinned at its foot; Buy is blue and Sell is outlined in red everywhere |
| 844 × 390 (landscape) | One-line price, the chart filling the height, and the dock |
| 600 to 1023 wide (foldable, tablets) | The ticket docks beside the page and the chart narrows |
| 1024 and wider | The desktop layout, with 44 px controls on a touch screen |
