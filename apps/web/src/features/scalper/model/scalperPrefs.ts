import { create } from 'zustand';
import { safeStorage } from '@/shared/lib/safeStorage';
import { QTY_PRESETS } from './scalpOrder';

const KEY = 'nthstock.scalper.v1';

export type ScalperPrefs = {
  /** The size the pad sends. */
  qty: number;
  /** The last custom size, shown as the fifth chip; null until one is typed. */
  customQty: number | null;
};

const DEFAULTS: ScalperPrefs = { qty: QTY_PRESETS[0], customQty: null };

const validQty = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 999_999;

function load(): ScalperPrefs {
  try {
    const saved: unknown = JSON.parse(safeStorage.get(KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return DEFAULTS;
    const { qty, customQty } = saved as Record<string, unknown>;
    return {
      qty: validQty(qty) ? qty : DEFAULTS.qty,
      customQty: validQty(customQty) ? customQty : null,
    };
  } catch {
    return DEFAULTS;
  }
}

type ScalperPrefsStore = ScalperPrefs & {
  pick: (qty: number) => void;
  pickCustom: (qty: number) => void;
};

/**
 * The scalper's size, remembered on this device (SPEC-TFC-1 §11.2): the chip last used and the
 * last custom size. Preferences only; nothing about orders is kept here.
 */
export const useScalperPrefs = create<ScalperPrefsStore>()((set, get) => {
  const save = () => {
    const { qty, customQty } = get();
    safeStorage.set(KEY, JSON.stringify({ qty, customQty }));
  };
  return {
    ...load(),
    pick: (qty) => {
      set({ qty });
      save();
    },
    pickCustom: (qty) => {
      set({ qty, customQty: qty });
      save();
    },
  };
});

/** Tests only: forget the saved size. */
export function resetScalperPrefs(): void {
  safeStorage.remove(KEY);
  useScalperPrefs.setState(DEFAULTS);
}
