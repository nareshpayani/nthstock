import type { AutoscaleInfo, ISeriesPrimitive, Time } from 'lightweight-charts';

/**
 * A series primitive that draws nothing itself: the library calls `updateAllViews` on every
 * repaint (a tick, pan, pinch or autoscale), and it hands that to the overlay, which moves its DOM
 * handles to the new coordinates without a React render (SPEC-TFC-1 §10.5). It adds nothing to
 * autoscale, so an order far from the price never squashes the candles.
 */
export class RepaintPrimitive implements ISeriesPrimitive<Time> {
  readonly #onRepaint: () => void;
  #requestUpdate: (() => void) | null = null;

  constructor(onRepaint: () => void) {
    this.#onRepaint = onRepaint;
  }

  attached({ requestUpdate }: { requestUpdate: () => void }): void {
    this.#requestUpdate = requestUpdate;
  }

  detached(): void {
    this.#requestUpdate = null;
  }

  updateAllViews(): void {
    this.#onRepaint();
  }

  autoscaleInfo(): AutoscaleInfo | null {
    return null;
  }

  /** Asks the chart for a repaint, e.g. after the lines change. */
  requestUpdate(): void {
    this.#requestUpdate?.();
  }
}
