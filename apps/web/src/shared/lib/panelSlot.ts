/**
 * The trading panels (order ticket, trailing stop, position editor) share one slot: docked beside
 * the page they would otherwise stack at the same place (SPEC-CR-1 §6.2). Each store registers
 * how to close itself and calls `claimPanelSlot` when it opens, which closes the other two.
 * Kept free of store imports so the three stores do not import each other.
 */
const closers = new Map<string, () => void>();

export function registerPanel(name: string, close: () => void): void {
  closers.set(name, close);
}

export function claimPanelSlot(name: string): void {
  for (const [other, close] of closers) if (other !== name) close();
}
