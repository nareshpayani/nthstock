import { Button } from '@nthstock/ui';
import { useState } from 'react';
import { useSimulator } from '@/shared/lib/demoSimulator';
import { strings } from '../strings';

export type SimulatorPanelProps = {
  symbol: string;
};

/**
 * The demo Simulator (SPEC-TFC-1 TFC-12): buttons that move the simulated price of `symbol`.
 * Renders nothing unless demo mode registered a Simulator, and says "Simulated" wherever it shows.
 */
export function SimulatorPanel({ symbol }: SimulatorPanelProps) {
  const simulator = useSimulator();
  const [split, setSplit] = useState<boolean | null>(null);
  if (!simulator) return null;
  const splitOn = split ?? simulator.splitFills(symbol);
  const s = strings.simulator;

  return (
    <section
      aria-label={s.label}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line bg-surface p-3"
    >
      <span className="rounded-sm bg-canvas px-2 py-0.5 text-label font-medium text-ink-muted">
        {s.badge}
      </span>
      <Button size="sm" variant="secondary" onClick={() => void simulator.rally(symbol)}>
        {s.rally}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => void simulator.pullBack(symbol)}>
        {s.pullBack}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => void simulator.gapDown(symbol)}>
        {s.gap}
      </Button>
      <Button
        size="sm"
        variant={splitOn ? 'primary' : 'secondary'}
        aria-pressed={splitOn}
        onClick={() => {
          const next = !splitOn;
          setSplit(next);
          void simulator.setSplitFills(symbol, next);
        }}
      >
        {s.split}
      </Button>
    </section>
  );
}
