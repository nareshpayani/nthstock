import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Drawing } from './drawings';
import { drawingsStorageKey, useDrawings } from './drawingsStore';

const SYMBOL = 'REMOVE1';
const line = (id: string, price: number): Drawing => ({
  id,
  kind: 'horizontal',
  at: { time: 1_000, price },
});
const stored = () => JSON.parse(window.localStorage.getItem(drawingsStorageKey(SYMBOL)) ?? '[]');

describe('drawingsStore.remove (NSTOCK-0468)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useDrawings.setState({ bySymbol: {}, cleared: {}, unsaved: {} });
  });
  afterEach(() => vi.restoreAllMocks());

  it('removes one drawing by id and saves the rest', () => {
    const { add, remove, drawingsFor } = useDrawings.getState();
    add(SYMBOL, line('a', 100));
    add(SYMBOL, line('b', 200));
    remove(SYMBOL, 'a');
    expect(drawingsFor(SYMBOL).map((drawing) => drawing.id)).toEqual(['b']);
    expect(stored()).toEqual([expect.objectContaining({ id: 'b' })]);
    expect(useDrawings.getState().unsaved[SYMBOL]).toBe(false);
  });

  it('leaves every drawing in place for an id that is not there', () => {
    const { add, remove, drawingsFor } = useDrawings.getState();
    add(SYMBOL, line('a', 100));
    remove(SYMBOL, 'missing');
    expect(drawingsFor(SYMBOL).map((drawing) => drawing.id)).toEqual(['a']);
  });

  it('marks the symbol unsaved, and keeps the change in memory, when storage fails', () => {
    const { add, remove, drawingsFor } = useDrawings.getState();
    add(SYMBOL, line('a', 100));
    add(SYMBOL, line('b', 200));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    remove(SYMBOL, 'a');
    expect(useDrawings.getState().unsaved[SYMBOL]).toBe(true);
    expect(drawingsFor(SYMBOL).map((drawing) => drawing.id)).toEqual(['b']);
  });
});
