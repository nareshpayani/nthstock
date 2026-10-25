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

/** sessionStorage key: Try demo reloaded the page to load the demo account, and carries on. */
export const DEMO_PENDING_STORAGE_KEY = 'nthstock.demoPending';

/**
 * What Try demo does next: `ready` when demo mode is on in this page; `reloading` when the page is
 * reloading with `?demo=1` to load the demo account first.
 */
export type DemoStart = 'ready' | 'reloading';

/**
 * Turns demo mode on. The mock backend sets it at start; in api mode nothing does, so
 * `startDemo` has nothing to do there.
 */
let demoStarter: (() => DemoStart) | null = null;

export function setDemoStarter(start: (() => DemoStart) | null): void {
  demoStarter = start;
}

/**
 * Try demo (REQ-DEL-02, TFC-12): a cold load of /login and one tap give the same app as `?demo=1`,
 * with the demo account's watchlists and holdings and the Demo simulator.
 */
export function startDemo(): DemoStart {
  return demoStarter?.() ?? 'ready';
}

/** Marks Try demo as pending across the `?demo=1` reload. */
export function markDemoPending(storage: Pick<Storage, 'setItem'>): boolean {
  try {
    storage.setItem(DEMO_PENDING_STORAGE_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** Drops a Try demo pending flag. */
export function clearDemoPending(storage: Pick<Storage, 'removeItem'>): void {
  try {
    storage.removeItem(DEMO_PENDING_STORAGE_KEY);
  } catch {
    // Nothing to clear without storage.
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
