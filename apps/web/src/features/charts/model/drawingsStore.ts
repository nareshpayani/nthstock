import { create } from 'zustand';
import { safeStorage } from '@/shared/lib/safeStorage';
import { parseDrawings, type Drawing, type DrawingTool } from './drawings';

export const drawingsStorageKey = (symbol: string) => `nth.chart.drawings.${symbol}`;
export const MAGNET_STORAGE_KEY = 'nth.chart.magnet';

/** Where a stored value that could not be read is set aside, so the next save does not lose it. */
export const unreadableDrawingsKey = (symbol: string) => `${drawingsStorageKey(symbol)}.unreadable`;

// Symbols whose stored value could not be read nor set aside: saving over it would lose it.
const unprotected = new Set<string>();

function readDrawings(symbol: string): Drawing[] {
  const raw = safeStorage.get(drawingsStorageKey(symbol));
  if (raw === null) return [];
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    stored = undefined;
  }
  const drawings = parseDrawings(stored);
  // Anything dropped as unreadable is kept aside before the next save overwrites the value.
  const dropped = !Array.isArray(stored) || drawings.length !== stored.length;
  if (dropped && !safeStorage.set(unreadableDrawingsKey(symbol), raw)) unprotected.add(symbol);
  return drawings;
}

const without = (record: Record<string, Drawing[]>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));

export type DrawingsState = {
  /** The tool waiting for taps on the chart; null is the plain crosshair (pan and zoom). */
  tool: DrawingTool | null;
  /** Snap points to the bar's open, high, low or close. Remembered on this device. */
  magnet: boolean;
  /** Each symbol's drawings, read from storage the first time the symbol is asked for. */
  bySymbol: Record<string, Drawing[]>;
  /** What the last Clear removed, per symbol, so Undo can bring it back. */
  cleared: Record<string, Drawing[]>;
  /** Symbols whose last save failed (storage full or blocked): their drawings last until the page closes. */
  unsaved: Record<string, boolean>;
  setTool: (tool: DrawingTool | null) => void;
  toggleMagnet: () => void;
  drawingsFor: (symbol: string) => Drawing[];
  add: (symbol: string, drawing: Drawing) => void;
  undo: (symbol: string) => void;
  clear: (symbol: string) => void;
};

/**
 * Chart drawings and the active tool (NSTOCK-0461). Drawings are kept per symbol on this device,
 * so a trend line drawn on INFY is there on the next visit, on every chart of INFY.
 */
export const useDrawings = create<DrawingsState>()((set, get) => {
  const save = (symbol: string, drawings: Drawing[]) => {
    const stored =
      !unprotected.has(symbol) &&
      safeStorage.set(drawingsStorageKey(symbol), JSON.stringify(drawings));
    set({
      bySymbol: { ...get().bySymbol, [symbol]: drawings },
      unsaved: { ...get().unsaved, [symbol]: !stored },
    });
  };
  return {
    tool: null,
    magnet: safeStorage.get(MAGNET_STORAGE_KEY) === 'on',
    bySymbol: {},
    cleared: {},
    unsaved: {},
    setTool: (tool) => set({ tool }),
    toggleMagnet: () => {
      const magnet = !get().magnet;
      safeStorage.set(MAGNET_STORAGE_KEY, magnet ? 'on' : 'off');
      set({ magnet });
    },
    drawingsFor: (symbol) => get().bySymbol[symbol] ?? readDrawings(symbol),
    add: (symbol, drawing) => {
      // A new drawing means the cleared ones are not coming back.
      if (get().cleared[symbol]) {
        set({ cleared: without(get().cleared, symbol) });
      }
      save(symbol, [...get().drawingsFor(symbol), drawing]);
    },
    undo: (symbol) => {
      const drawings = get().drawingsFor(symbol);
      const cleared = get().cleared[symbol];
      if (drawings.length === 0 && cleared) {
        set({ cleared: without(get().cleared, symbol) });
        save(symbol, cleared);
        return;
      }
      save(symbol, drawings.slice(0, -1));
    },
    clear: (symbol) => {
      const drawings = get().drawingsFor(symbol);
      if (drawings.length > 0) set({ cleared: { ...get().cleared, [symbol]: drawings } });
      save(symbol, []);
    },
  };
});

/** One symbol's drawings, subscribed. */
export function useSymbolDrawings(symbol: string): Drawing[] {
  return useDrawings((state) => state.bySymbol[symbol]) ?? readDrawingsOnce(symbol);
}

// A symbol's stored drawings, read once per symbol so a render does not parse storage each time.
const firstRead = new Map<string, Drawing[]>();
function readDrawingsOnce(symbol: string): Drawing[] {
  let drawings = firstRead.get(symbol);
  if (!drawings) {
    drawings = readDrawings(symbol);
    firstRead.set(symbol, drawings);
  }
  return drawings;
}
