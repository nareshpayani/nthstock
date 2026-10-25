import type { OrderSide } from '@nthstock/contracts';
import { BinaryHeap } from './binaryHeap.js';
import { assertPositivePaise } from './context.js';
import { stepTrailingStop, type TrailingStopState } from './trailingStop.js';

/** A resting LIMIT order as the book holds it. `price` is the limit in paise. */
export type BookOrder = {
  orderId: string;
  userId: string;
  /** The order's version in the account store; a change applies only with a newer one. */
  version: number;
  side: OrderSide;
  price: number;
};

/** A trailing stop as the book holds it: only ARMED and TRAILING stops rest on the book. */
export type BookStop = {
  stopId: string;
  userId: string;
  version: number;
  state: TrailingStopState;
};

export type BookTick = {
  /** LIMIT orders this price crosses, now off the book (put back with `restoreOrder`). */
  crossed: BookOrder[];
  /** Stops this price triggers, in their TRIGGERED state, now off the book. */
  triggered: BookStop[];
  /** Stops this price activated or ratcheted, in their new state; they stay on the book. */
  moved: BookStop[];
  /** Heap entries read, stale ones included: what the matcher benchmark counts per tick. */
  read: number;
};

type Keyed = { id: string; seq: number; key: number };
/** `crossed`: a tick took it off the book, so `restoreOrder` may put it back at the same version. */
type Held = { version: number; crossed: boolean };

const min = (a: Keyed, b: Keyed) => a.key < b.key;
const max = (a: Keyed, b: Keyed) => a.key > b.key;

/**
 * One instrument's orders and trailing stops, indexed by price (spec market-data-and-matching
 * §5.1, NSTOCK-0363), so a tick reads only what it acts on instead of every resting order:
 *
 * | Heap | Order | Acts when |
 * |---|---|---|
 * | BUY LIMIT | highest limit first | LTP ≤ limit |
 * | SELL LIMIT | lowest limit first | LTP ≥ limit |
 * | long stop (sells) | highest stop first | LTP ≤ stop: triggers |
 * | short stop (buys) | lowest stop first | LTP ≥ stop: triggers |
 * | long watermark | lowest first | LTP above it: ratchets |
 * | short watermark | highest first | LTP below it: ratchets |
 * | long ARMED | lowest activation first | LTP ≥ activation: activates |
 * | short ARMED | highest activation first | LTP ≤ activation: activates |
 *
 * Every stop it touches moves by `stepTrailingStop`, the rule the engine and the browser mock run,
 * so a tick leaves each stop exactly where stepping every stop would. A change is applied only when
 * its version is newer than the one held (§5.3); removed and replaced entries are dropped lazily
 * when they reach the top of a heap.
 */
export class OrderBook {
  readonly #buys = new BinaryHeap<Keyed>(max);
  readonly #sells = new BinaryHeap<Keyed>(min);
  readonly #longStops = new BinaryHeap<Keyed>(max);
  readonly #shortStops = new BinaryHeap<Keyed>(min);
  readonly #longMarks = new BinaryHeap<Keyed>(min);
  readonly #shortMarks = new BinaryHeap<Keyed>(max);
  readonly #longArmed = new BinaryHeap<Keyed>(min);
  readonly #shortArmed = new BinaryHeap<Keyed>(max);

  readonly #orders = new Map<string, { order: BookOrder; seq: number }>();
  readonly #stops = new Map<string, { stop: BookStop; seq: number }>();
  /** The newest version seen per id, kept after removal so a late, older command is ignored. */
  readonly #orderVersions = new Map<string, Held>();
  readonly #stopVersions = new Map<string, Held>();
  #seq = 0;

  /** Resting LIMIT orders and live stops on the book. */
  get size(): { orders: number; stops: number } {
    return { orders: this.#orders.size, stops: this.#stops.size };
  }

  hasOrder(orderId: string): boolean {
    return this.#orders.has(orderId);
  }

  hasStop(stopId: string): boolean {
    return this.#stops.has(stopId);
  }

  /** `ADD` or `MODIFY`: rests the order at its price. False when the version is not newer. */
  upsertOrder(order: BookOrder): boolean {
    if (!newer(this.#orderVersions.get(order.orderId), order.version)) return false;
    assertPositivePaise(order.price, 'Limit price');
    this.#orderVersions.set(order.orderId, { version: order.version, crossed: false });
    const seq = this.#next();
    this.#orders.set(order.orderId, { order, seq });
    const entry = { id: order.orderId, seq, key: order.price };
    (order.side === 'BUY' ? this.#buys : this.#sells).push(entry);
    return true;
  }

  /**
   * Puts back an order a tick crossed, at the same version, when its fill did not commit or left
   * a remainder. False when a newer change has arrived since.
   */
  restoreOrder(order: BookOrder): boolean {
    const held = this.#orderVersions.get(order.orderId);
    if (!held?.crossed || held.version !== order.version) return this.upsertOrder(order);
    this.#orderVersions.delete(order.orderId);
    return this.upsertOrder(order);
  }

  /** `CANCEL`, or an order that filled or expired elsewhere. False when the version is not newer. */
  removeOrder(orderId: string, version: number): boolean {
    if (!newer(this.#orderVersions.get(orderId), version)) return false;
    this.#orderVersions.set(orderId, { version, crossed: false });
    this.#orders.delete(orderId);
    return true;
  }

  /**
   * `STOP_ADD`, or a stop's new state: ARMED and TRAILING stops rest on the book, any other status
   * takes the stop off. False when the version is not newer.
   */
  upsertStop(stop: BookStop): boolean {
    if (!newer(this.#stopVersions.get(stop.stopId), stop.version)) return false;
    const resting = stop.state.status === 'ARMED' || stop.state.status === 'TRAILING';
    this.#stopVersions.set(stop.stopId, { version: stop.version, crossed: false });
    if (resting) this.#placeStop(stop);
    else this.#stops.delete(stop.stopId);
    return true;
  }

  /** `STOP_CANCEL`. False when the version is not newer. */
  removeStop(stopId: string, version: number): boolean {
    if (!newer(this.#stopVersions.get(stopId), version)) return false;
    this.#stopVersions.set(stopId, { version, crossed: false });
    this.#stops.delete(stopId);
    return true;
  }

  /** One tick at `ltp` paise: pops what it crosses, triggers, ratchets and activates. */
  tick(ltp: number): BookTick {
    assertPositivePaise(ltp, 'LTP');
    const result: BookTick = { crossed: [], triggered: [], moved: [], read: 0 };

    for (const [heap, crosses] of [
      [this.#buys, (key: number) => ltp <= key],
      [this.#sells, (key: number) => ltp >= key],
    ] as const) {
      for (const id of this.#drain(heap, this.#orders, crosses, result)) {
        const held = this.#orders.get(id);
        if (!held) continue;
        this.#orders.delete(id);
        this.#orderVersions.set(id, { version: held.order.version, crossed: true });
        result.crossed.push(held.order);
      }
    }

    // Triggers first, then ratchets, then activations: a stop that moves on this tick ends with
    // its stop beyond the price, so no stop is stepped twice, as stepping each stop once would.
    for (const [heap, acts] of [
      [this.#longStops, (key: number) => ltp <= key],
      [this.#shortStops, (key: number) => ltp >= key],
      [this.#longMarks, (key: number) => ltp > key],
      [this.#shortMarks, (key: number) => ltp < key],
      [this.#longArmed, (key: number) => ltp >= key],
      [this.#shortArmed, (key: number) => ltp <= key],
    ] as const) {
      for (const id of this.#drain(heap, this.#stops, acts, result)) {
        const held = this.#stops.get(id);
        if (!held) continue;
        const { state, triggered } = stepTrailingStop(held.stop.state, ltp);
        const stop = { ...held.stop, state };
        if (triggered) {
          this.#stops.delete(id);
          this.#stopVersions.set(id, { version: stop.version, crossed: true });
          result.triggered.push(stop);
        } else {
          this.#placeStop(stop);
          result.moved.push(stop);
        }
      }
    }
    return result;
  }

  #next(): number {
    this.#seq += 1;
    return this.#seq;
  }

  #placeStop(stop: BookStop): void {
    const seq = this.#next();
    this.#stops.set(stop.stopId, { stop, seq });
    const { state } = stop;
    const long = state.direction === 'LONG';
    const id = stop.stopId;
    if (state.status === 'ARMED') {
      // No activation price: it activates on the next tick, whatever the price.
      const key = state.activationPrice ?? (long ? 0 : Number.POSITIVE_INFINITY);
      (long ? this.#longArmed : this.#shortArmed).push({ id, seq, key });
      return;
    }
    if (state.stopPrice === null || state.watermarkPrice === null) return;
    (long ? this.#longStops : this.#shortStops).push({ id, seq, key: state.stopPrice });
    (long ? this.#longMarks : this.#shortMarks).push({ id, seq, key: state.watermarkPrice });
  }

  /** Pops the live entries at the top of `heap` while `acts(key)`, dropping stale ones. */
  #drain(
    heap: BinaryHeap<Keyed>,
    live: ReadonlyMap<string, { seq: number }>,
    acts: (key: number) => boolean,
    result: BookTick,
  ): string[] {
    const ids: string[] = [];
    for (let top = heap.peek(); top; top = heap.peek()) {
      if (live.get(top.id)?.seq !== top.seq) {
        heap.pop();
        result.read += 1;
        continue;
      }
      if (!acts(top.key)) break;
      heap.pop();
      result.read += 1;
      ids.push(top.id);
    }
    return ids;
  }
}

const newer = (held: Held | undefined, version: number) => !held || version > held.version;
