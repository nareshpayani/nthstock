import { describe, expect, it } from 'vitest';
import { moveItem } from './sortItems';
import { dropIndex } from './dropIndex';

// Five 50 px rows: middles at 25, 75, 125, 175, 225.
const middleOf = (index: number) => index * 50 + 25;

describe('dropIndex (T-122)', () => {
  it('stays put while the pointer is still over its own row', () => {
    expect(dropIndex(5, 2, 110, middleOf)).toBe(2);
    expect(dropIndex(5, 2, 140, middleOf)).toBe(2);
  });

  it('moves down past each middle it crosses', () => {
    expect(dropIndex(5, 0, 80, middleOf)).toBe(1);
    expect(dropIndex(5, 0, 400, middleOf)).toBe(4);
    expect(moveItem(['a', 'b', 'c', 'd', 'e'], 0, dropIndex(5, 0, 130, middleOf))).toEqual([
      'b',
      'c',
      'a',
      'd',
      'e',
    ]);
  });

  it('moves up past each middle it crosses', () => {
    expect(dropIndex(5, 4, 70, middleOf)).toBe(1);
    expect(dropIndex(5, 4, -10, middleOf)).toBe(0);
  });
});
