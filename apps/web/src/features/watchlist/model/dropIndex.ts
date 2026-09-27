/**
 * Where a dragged entry lands (T-122): the number of other entries whose middle is before the
 * pointer. That is the index to move it to with `moveItem` (remove, then insert).
 * `middleOf(i)` and `pointer` are in the same coordinate space, e.g. px from the list's top.
 */
export function dropIndex(
  count: number,
  from: number,
  pointer: number,
  middleOf: (index: number) => number,
): number {
  let target = 0;
  for (let index = 0; index < count; index += 1) {
    if (index !== from && middleOf(index) < pointer) target += 1;
  }
  return target;
}
