import { useSyncExternalStore } from 'react';

/**
 * The demo Simulator's seam (SPEC-TFC-1 TFC-12). The mock backend registers its actions only in
 * demo mode; the UI renders the controls only while some are registered, so outside demo mode
 * (and in api mode, where nothing registers) there is nothing to show.
 */
export type SimulatorActions = {
  /** Rally: the price rises 1% over the next few ticks. */
  rally(symbol: string): Promise<boolean>;
  /** Pull back: the price falls 1% over the next few ticks. */
  pullBack(symbol: string): Promise<boolean>;
  /** Gap: the price drops 3% at once. */
  gapDown(symbol: string): Promise<boolean>;
  /** Split large fills: LIMIT orders in `symbol` fill in small slices over several ticks. */
  setSplitFills(symbol: string, on: boolean): Promise<void>;
  splitFills(symbol: string): boolean;
};

/** sessionStorage key: demo mode survives a reload, but not a new browser session. */
export const DEMO_MODE_STORAGE_KEY = 'nthstock.demoMode';

export function isDemoMode(storage: Pick<Storage, 'getItem'>): boolean {
  try {
    return storage.getItem(DEMO_MODE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function enterDemoMode(storage: Pick<Storage, 'setItem'>): void {
  try {
    storage.setItem(DEMO_MODE_STORAGE_KEY, '1');
  } catch {
    // Without storage the demo lasts until the next reload.
  }
}

let current: SimulatorActions | null = null;
const listeners = new Set<() => void>();

/** Registers the Simulator (null removes it). Returns an unregister function. */
export function registerSimulator(actions: SimulatorActions | null): () => void {
  current = actions;
  for (const listener of listeners) listener();
  return () => {
    if (current === actions) registerSimulator(null);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSimulator(): SimulatorActions | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
