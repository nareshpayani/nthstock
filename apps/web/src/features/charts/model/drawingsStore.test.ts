import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Drawing } from './drawings';
import { drawingsStorageKey, useDrawings } from './drawingsStore';

const line = (id: string, price: number): Drawing => ({
  id,
  kind: 'horizontal',
  at: { time: 1_700_000_000, price },
});

const stored = () => JSON.parse(window.localStorage.getItem(drawingsStorageKey('INFY')) ?? '[]');

beforeEach(() => {
  window.localStorage.clear();
  useDrawings.setState({ tool: null, magnet: false, bySymbol: {}, cleared: {}, unsaved: {} });
});

describe('removing one drawing (NSTOCK-0468)', () => {
  it('removes it by id and saves the rest', () => {
    const { add, remove } = useDrawings.getState();
    add('INFY', line('a', 100));
    add('INFY', line('b', 200));
    remove('INFY', 'a');
    expect(useDrawings.getState().drawingsFor('INFY')).toEqual([line('b', 200)]);
    expect(stored()).toEqual([line('b', 200)]);
  });

  it('leaves the drawings as they are for an id that is not there', () => {
    const { add, remove } = useDrawings.getState();
    add('INFY', line('a', 100));
    remove('INFY', 'missing');
    expect(stored()).toEqual([line('a', 100)]);
  });

  it('marks the drawings not saved when storage refuses the write', () => {
    const { add, remove } = useDrawings.getState();
    add('INFY', line('a', 100));
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('QuotaExceededError');
    });
    remove('INFY', 'a');
    expect(useDrawings.getState().drawingsFor('INFY')).toEqual([]);
    expect(useDrawings.getState().unsaved['INFY']).toBe(true);
    setItem.mockRestore();
  });
});
