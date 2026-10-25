/**
 * A binary heap ordered by `before(a, b)`: true when `a` comes out before `b`. The order book keeps
 * one per side and trigger (NSTOCK-0363), so a tick reads only the top entries it crosses.
 */
export class BinaryHeap<T> {
  readonly #items: T[] = [];
  readonly #before: (a: T, b: T) => boolean;

  constructor(before: (a: T, b: T) => boolean) {
    this.#before = before;
  }

  get size(): number {
    return this.#items.length;
  }

  peek(): T | undefined {
    return this.#items[0];
  }

  push(item: T): void {
    const items = this.#items;
    items.push(item);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.#before(item, items[parent] as T)) break;
      items[index] = items[parent] as T;
      index = parent;
    }
    items[index] = item;
  }

  pop(): T | undefined {
    const items = this.#items;
    const top = items[0];
    const last = items.pop();
    if (items.length === 0 || last === undefined) return top;
    let index = 0;
    for (;;) {
      const left = 2 * index + 1;
      if (left >= items.length) break;
      const right = left + 1;
      const child =
        right < items.length && this.#before(items[right] as T, items[left] as T) ? right : left;
      if (!this.#before(items[child] as T, last)) break;
      items[index] = items[child] as T;
      index = child;
    }
    items[index] = last;
    return top;
  }
}
