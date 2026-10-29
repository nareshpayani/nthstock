import { Button, cn } from '@nthstock/ui';
import { useEffect, useId, useState } from 'react';
import { PAGE_STATES, useConnectivityStore } from '@/shared/lib/connectivity';
import { useSimulator } from '@/shared/lib/demoSimulator';
import { strings } from '../strings';

export type SimulatorPanelProps = {
  symbol: string;
  /**
   * Folded to one small "Demo controls" button until tapped (NSTOCK-0447): on a phone the panel
   * otherwise sits between the chart and the tabs and reads as developer tooling.
   */
  collapsible?: boolean;
};

/**
 * The demo Simulator (SPEC-TFC-1 TFC-12): buttons that move the simulated price of `symbol`.
 * Renders nothing unless demo mode registered a Simulator, and says "Simulated" wherever it shows.
 */
export function SimulatorPanel({ symbol, collapsible = false }: SimulatorPanelProps) {
  const simulator = useSimulator();
  const [open, setOpen] = useState(!collapsible);
  const controlsId = useId();
  const [split, setSplit] = useState<boolean | null>(null);
  const forced = useConnectivityStore((state) => state.forced);
  const setForced = useConnectivityStore((state) => state.setForced);
  // A forced state belongs to this page: leaving it puts the page back to live.
  useEffect(() => () => useConnectivityStore.getState().setForced('live'), []);
  if (!simulator) return null;
  const splitOn = split ?? simulator.splitFills(symbol);
  const s = strings.simulator;

  return (
    <section
      aria-label={s.label}
      className={cn(
        'flex flex-wrap items-center gap-2',
        open && 'rounded-lg border border-dashed border-line bg-surface p-3',
      )}
    >
      {collapsible ? (
        <Button
          size="sm"
          variant="secondary"
          aria-expanded={open}
          aria-controls={open ? controlsId : undefined}
          onClick={() => setOpen((shown) => !shown)}
        >
          {open ? s.hide : s.show}
        </Button>
      ) : null}
      {open ? (
        <div id={controlsId} className="contents">
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
          {/* Each state of the page on demand (SPEC-CR-1 §7, CR-11). */}
          <div
            role="group"
            aria-label={s.statesLabel}
            className="flex basis-full flex-wrap items-center gap-2"
          >
            <span className="text-label font-medium text-ink-muted">{s.states}</span>
            {PAGE_STATES.map((state) => (
              <Button
                key={state}
                size="sm"
                variant={forced === state ? 'primary' : 'secondary'}
                aria-pressed={forced === state}
                onClick={() => setForced(state)}
              >
                {s.stateNames[state]}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
