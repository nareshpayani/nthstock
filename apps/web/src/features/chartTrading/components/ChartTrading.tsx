import type { Instrument } from '@nthstock/contracts';
import { formatInr } from '@nthstock/utils';
import { useState } from 'react';
import type { ChartHandle } from '@/features/charts';
import type { OverlayLine } from '../model/overlayLine';
import { strings } from '../strings';
import { ChartOverlay } from './ChartOverlay';

export type ChartTradingProps = {
  handle: ChartHandle;
  instrument: Pick<Instrument, 'symbol' | 'tickSize'>;
};

const GHOST = 'ghost';

/**
 * Trading on the instrument chart (T15 foundation, SPEC-TFC-1 §8.2). Tap the price gutter for a
 * ghost line at that price; drag its handle, or use the arrow keys, to adjust it. The price
 * follows the finger and is kept only on release. Order lines (T16), placing from the ghost (T17)
 * and the position line (T18) build on this.
 */
export function ChartTrading({ handle, instrument }: ChartTradingProps) {
  const [ghost, setGhost] = useState<number | null>(null);
  // While a handle moves, the line follows this price; it is dropped on release or cancel.
  const [pending, setPending] = useState<{ id: string; price: number } | null>(null);

  const lines: OverlayLine[] = [];
  if (ghost !== null) {
    const price = pending?.id === GHOST ? pending.price : ghost;
    lines.push({
      id: GHOST,
      price,
      tone: 'ghost',
      label: strings.ghost.label(formatInr(price)),
      description: strings.ghost.description(formatInr(price)),
      draggable: true,
    });
  }

  return (
    <ChartOverlay
      handle={handle}
      lines={lines}
      tickSize={instrument.tickSize}
      label={strings.group(instrument.symbol)}
      onGutterTap={(price) => {
        setPending(null);
        setGhost(price);
      }}
      onDragMove={(id, price) => setPending({ id, price })}
      onDragEnd={(id, price) => {
        setPending(null);
        if (id === GHOST && price !== null) setGhost(price);
      }}
      onHandleDelete={(id) => {
        if (id === GHOST) setGhost(null);
      }}
    />
  );
}
